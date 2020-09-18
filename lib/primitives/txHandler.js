'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TxHandler = undefined;

var _bn = require('bn.js');

var _bn2 = _interopRequireDefault(_bn);

var _ramda = require('ramda');

var _logger = require('../logger');

var _core_pb = require('../protos/core_pb');

var _index = require('../script/index');

var _index2 = _interopRequireDefault(_index);

var _txUtils = require('../core/txUtils');

var _bytecode = require('bcjs/dist/script/bytecode');

var _decimal = require('decimal.js');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const { calcTxFee } = require('bcjs/dist/transaction'); /**
                                                         * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
                                                         *
                                                         * This source code is licensed under the MIT license found in the
                                                         * LICENSE file in the root directory of this source tree.
                                                         *
                                                         * 
                                                         */


const { inspect } = require('util');
const { getScriptType, ScriptType } = require('bcjs/dist/script/templates');

const {
  parseMakerLockScript
} = require('../core/txUtils');

const {
  internalToHuman,
  CurrencyConverter,
  CurrencyInfo,
  COIN_FRACS: { NRG }
} = require('../core/coin');
const debugFactory = require('debug');
const debug = debugFactory('bcnode:primitives:txHandler');

class TxHandler {

  constructor(persistence, txPendingPool) {
    this._logger = (0, _logger.getLogger)(__filename);
    this._persistence = persistence;
    this._txPendingPool = txPendingPool;
    this._interpreter = new _index2.default(this._persistence);
  }

  async validateOutputs(tx, block) {
    const outputs = tx.getOutputsList();
    if (tx.getNoutCount() !== outputs.length || outputs.length === 0) {
      debug(`TX ${hash} invalid - noutCount didn't match actual output count or zero outputs, outputs.length: ${outputs.length}`);
      return false;
    }

    // transactions are invalid if there is more than one OP_MONAD in the output scripts.
    let outputMonadsCount = 0;
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i];
      const outputScript = (0, _bytecode.toASM)(Buffer.from(output.getOutputScript()), 0x01);
      debug('OUTPUT script %o', outputScript);
      if (!_txUtils.ScriptTemplates.validateScript(Buffer.from(output.getOutputScript()))) {
        this._logger.warn(`invalid script format, script: ${outputScript}`);
        return false;
      }

      //ensure taker outputs are in increment of the nrgUnit
      let scriptType = getScriptType(output.getOutputScript());
      if (scriptType == 'taker_output') {
        let [makerScript, b, makerOutput] = await this._persistence.getInitialMakerOrder(outputScript);
        const { base } = parseMakerLockScript(makerScript);

        let val = new _decimal.Decimal(internalToHuman(output.getValue(), NRG).toString()).div(new _decimal.Decimal(base));
        let unit = new _decimal.Decimal(internalToHuman(makerOutput.getUnit(), NRG).toString());

        if (!val.mod(unit).eq(new _decimal.Decimal(0))) {
          this._logger.warn(`taker output is not in increment of the original nrg unit`);
          return false;
        }
      }

      if (!_txUtils.ScriptTemplates.validateOutput(output, block)) {
        this._logger.warn(`output invalid, script ${outputScript}, output: ${inspect(output.toObject(), { depth: 5 })}`);
        return false;
      }

      // DEBUG
      if (outputScript.includes('OP_MONAD')) {
        outputMonadsCount += 1;
      }
      if (outputMonadsCount >= 2) {
        debug(`TX ${hash} invalid - error while checking outputMonadsCount: ${outputMonadsCount}`);
        return false;
      }
      const value = new _bn2.default(output.getValue());
      if (value.lt(new _bn2.default(0))) {
        debug(`TX ${hash} invalid - output value is < 0 (${value.toString()})`);
        return false;
      }
    }
    return true;
  }

  /**
   * @return true if all of conditions from:
   * https://en.bitcoin.it/wiki/Protocol_rules#.22tx.22_messages
   * are true
   */
  async isValidTx(tx, opts) {
    // Check syntactic correctness
    // mind that first step done already by deserializing from protobuf
    debug('isValid() TX hash: %s, %O', tx.getHash(), tx.toObject());

    const blockchain = tx.getId ? tx.getId() : 'bc';
    const hash = tx.getHash();
    let { latestBlockHeight } = opts;

    if (!latestBlockHeight) {
      let latestBlock = await this._persistence.get(`bc.block.latest`);
      latestBlockHeight = latestBlock.getHeight();
    }

    // Make sure neither in or out lists are empty (in is empty only in case of coinbase TX)
    const inputs = tx.getInputsList();
    if (tx.getNinCount() !== inputs.length) {
      // coinbase has 0 inputs
      this._logger.info(`TX ${hash} invalid - ninCount didn't match actual input count or zero inputs, inputs.length: ${inputs.length}`);
      return false;
    }

    const validOutputs = await this.validateOutputs(tx, opts.block);
    debug(`validOutputs ${validOutputs}`);

    if (!validOutputs) {
      this._txPendingPool.markTxsAsMined([tx]);
      return false;
    }

    //Ensure Input Value is Greater than Output Value
    try {
      if (calcTxFee(tx).lt(new _bn2.default(0))) {
        debug(`calcTxFee - ${calcTxFee(tx).lt(new _bn2.default(0))}`);

        this._txPendingPool.markTxsAsMined([tx]);
        return false;
      }
    } catch (err) {
      debug(`err - ${err}`);
      this._txPendingPool.markTxsAsMined([tx]);
      return false;
    }

    //check if any inputs are already spent or being spent in the txPendingPool
    let beingSpent = await this._txPendingPool.isAnyInputSpent(tx);
    if (beingSpent) {
      debug(`input is already being spent for ${tx.getHash()}`);
      this._txPendingPool.markTxsAsMined([tx]);
      return false;
    }

    for (let input of inputs) {
      if (input.getScriptLength() !== input.getInputScript().length) {
        this._logger.info(`TX ${hash} invalid - input script length didn't match: i: ${input.toObject()}, scriptLength: ${input.getScriptLength()}, actual: ${input.getInputScript().length}`);
        return false;
      }

      // Reject "nonstandard" transactions: scriptSig doing anything other than pushing numbers on the stack, or scriptPubkey not matching the two usual forms[4]
      const inputScript = (0, _bytecode.toASM)(Buffer.from(input.getInputScript()), 0x01);
      if (!_txUtils.ScriptTemplates.validateScript(Buffer.from(input.getInputScript()))) {
        this._logger.warn(`invalid script format, script: ${inputScript}`);
        return false;
      }

      const outpoint = input.getOutPoint();
      const referencedTx = opts.referenced ? opts.referenced[outpoint.getHash()] : await this._persistence.getTransactionByHash(outpoint.getHash());
      if (!referencedTx) {
        this._logger.info(`TX ${hash} invalid - could not find referenced tx blockchain: ${blockchain}, hash: ${outpoint.getHash()}`);
        return false;
      }
      const referencedOutput = referencedTx.getOutputsList()[outpoint.getIndex()];
      if (!referencedOutput) {
        this._logger.info(`TX ${hash} invalid - could not find referenced output h: ${outpoint.getHash()}, i: ${outpoint.getIndex()}`);
        return false;
      }

      // check if the outpoint value being spent is the same as the original
      if (!new _bn2.default(Buffer.from(outpoint.getValue(), 'base64')).eq(new _bn2.default(referencedOutput.getValue()))) {
        this._logger.info(`TX ${hash} invalid, outpoint value != referencedOutput value of hash and index- ${outpoint.getHash()}, ${outpoint.getIndex()}`);
        return false;
      }

      if (referencedTx.getLockTime() > latestBlockHeight) {
        this._logger.info(`TX ${hash} invalid - referenced TX is not mature enough, will be mature at: ${referencedTx.getLockTime()}, latest block height: ${latestBlockHeight}`);
        return false;
      }

      // Verify the scriptPubKey accepts for each input; reject if any are bad
      // DEBUG
      // debug('OUTPUT SCRIPT %o INPUT SCRIPT %o', toASM(Buffer.from(referencedOutput.getOutputScript()), 0x01), toASM(Buffer.from(input.getInputScript()), 0x01))
      let result = await this._interpreter.evaluateAsync((0, _bytecode.toASM)(Buffer.from(referencedOutput.getOutputScript()), 0x01), // Output Script
      inputScript, // Input Script
      input, // Transaction input
      tx, // Transaction -> complete
      false, //allow disabled
      opts.block //Block in which Transaction is in
      );
      if (!result) {
        this._txPendingPool.markTxsAsMined([tx]);
        this._logger.info(`script did not validate, result: ${result}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Returns true if all TXs valid or array of invalid TX hashes
   *
   * @param possibleTxs {Transaction[]} array of transactions with first assuming to be a coinbase
   */
  async validateTxs(block) {
    // check if any if the txs are trying to spend the same outpoint
    let date = Date.now();
    let possibleTxs = block.getTxsList().slice(1);

    let promises = possibleTxs.reduce((all, tx) => {
      return all.concat(tx.getInputsList().map(input => {
        return this._persistence.getTransactionByHash(input.getOutPoint().getHash());
      }));
    }, []);
    // console.log(`time found took ${Date.now() - date}`)

    let referencedTxs = await Promise.all(promises);

    referencedTxs = referencedTxs.filter(r => {
      return r != null;
    });

    let referenced = {};
    for (let ref of referencedTxs) {
      referenced[ref.getHash()] = ref;
    }

    let validTxs = await Promise.all(possibleTxs.map((tx, i) => {
      return this.isValidTx(tx, { referenced, block, latestBlockHeight: block.getHeight() });
    }));

    return validTxs.reduce((all, curr) => {
      return all && curr;
    }, true);
  }
}
exports.TxHandler = TxHandler;