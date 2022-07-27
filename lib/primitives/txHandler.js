'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TxHandler = undefined;

var _bn = require('bn.js');

var _bn2 = _interopRequireDefault(_bn);

var _logger = require('../logger');

var _core_pb = require('@overline/proto/proto/core_pb');

var _index = require('../script/index');

var _index2 = _interopRequireDefault(_index);

var _txUtils = require('../core/txUtils');

var _bytecode = require('bcjs/dist/script/bytecode');

var _decimal = require('decimal.js');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const BC_SUPER_COLLIDER = process.env.BC_SUPER_COLLIDER ? process.env.BC_SUPER_COLLIDER.toLowerCase() : 'bc'; /**
                                                                                                               * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
                                                                                                               *
                                                                                                               * This source code is licensed under the MIT license found in the
                                                                                                               * LICENSE file in the root directory of this source tree.
                                                                                                               *
                                                                                                               * 
                                                                                                               */

const { calcTxFee } = require('bcjs/dist/transaction');
const { inspect } = require('util');
const { getScriptType, ScriptType } = require('bcjs/dist/script/templates');
const { orderedHashes } = require('../config/networks');

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
// Counter Party Transition Block Tx
const subs = new Set(['92421f4ca3c36a31fcc6c38ad904505afcc3667ff06ffb44186ca87bbad454c6']);
const scouts = new Set(orderedHashes);

class TxHandler {

  constructor(persistence, txPendingPool, utxoManager) {
    this._logger = (0, _logger.getLogger)(__filename);
    this._persistence = persistence;
    this._txPendingPool = txPendingPool;
    this._utxoManager = utxoManager;
    this._interpreter = new _index2.default(this._persistence, this._utxoManager);
  }

  async validateOutputsError(tx, block) {
    const outputs = tx.getOutputsList();
    if (tx.getNoutCount() !== outputs.length || outputs.length === 0) {
      return { err: `invalid - noutCount didn't match actual output count or zero outputs, outputs.length: ${outputs.length}` };
    }

    // transactions are invalid if there is more than one OP_MONAD in the output scripts.
    let outputMonadsCount = 0;
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i];
      const outputScript = (0, _bytecode.toASM)(Buffer.from(output.getOutputScript()), 0x01);
      debug('OUTPUT script %o', outputScript);
      if (!_txUtils.ScriptTemplates.validateScript(Buffer.from(output.getOutputScript()))) {
        return { err: `invalid script format, script: ${outputScript}` };
      }

      //ensure taker outputs are in increment of the nrgUnit
      let scriptType = getScriptType(output.getOutputScript());
      debug(`process script type: ${scriptType}`);
      if (scriptType == 'taker_output') {
        try {
          let [makerScript, b, makerOutput] = await this._utxoManager.getInitialMakerOrder(outputScript);
          const { base } = parseMakerLockScript(makerScript);

          let val = new _decimal.Decimal(internalToHuman(output.getValue(), NRG).toString()).div(new _decimal.Decimal(base));
          let unit = new _decimal.Decimal(internalToHuman(makerOutput.getUnit(), NRG).toString());

          if (!val.mod(unit).eq(new _decimal.Decimal(0))) {
            return { err: `taker output is not in increment of the original nrg unit` };
          }
        } catch (err) {
          return { err: `couldn't find maker order for ${outputScript}` };
        }
      } else if (scriptType === 'feed_create') {
        this._logger.info(`feed creation event`);
      } else if (scriptType === 'feed_update') {
        this._logger.info(`feed update event`);
      }

      if (!_txUtils.ScriptTemplates.validateOutput(output, block)) {
        return { err: `output invalid, script ${outputScript}, output: ${inspect(output.toObject(), { depth: 5 })}` };
      }

      // DEBUG
      if (outputScript.includes('OP_MONAD')) {
        outputMonadsCount += 1;
      }
      if (outputMonadsCount >= 2) {
        return { err: `TX ${hash} invalid - error while checking outputMonadsCount: ${outputMonadsCount}` };
      }
      const value = new _bn2.default(output.getValue());
      if (value.lt(new _bn2.default(0))) {
        return { err: `TX ${hash} invalid - output value is < 0 (${value.toString()})` };
      }
    }
    return { success: true };
  }

  async validateOutputs(tx, block) {
    const outputs = tx.getOutputsList();
    if (tx.getNoutCount() !== outputs.length || outputs.length === 0) {
      debug(`invalid - noutCount didn't match actual output count or zero outputs, outputs.length: ${outputs.length}`);
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
      debug(`process script type: ${scriptType}`);
      if (scriptType == 'taker_output') {
        try {
          let [makerScript, b, makerOutput] = await this._utxoManager.getInitialMakerOrder(outputScript);
          const { base } = parseMakerLockScript(makerScript);

          let val = new _decimal.Decimal(internalToHuman(output.getValue(), NRG).toString()).div(new _decimal.Decimal(base));
          let unit = new _decimal.Decimal(internalToHuman(makerOutput.getUnit(), NRG).toString());

          if (!val.mod(unit).eq(new _decimal.Decimal(0))) {
            this._logger.warn(`taker output is not in increment of the original nrg unit`);
            return false;
          }
        } catch (err) {
          this._logger.warn(`couldn't find maker order for ${outputScript}`);
          return false;
        }
      } else if (scriptType === 'feed_create') {
        this._logger.info(`feed creation event`);
      } else if (scriptType === 'feed_update') {
        this._logger.info(`feed update event`);
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

    if (subs.has(hash)) {
      return true;
    }

    if (!latestBlockHeight) {
      let latestBlock = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
      latestBlockHeight = latestBlock.getHeight();
    }

    // Make sure neither in or out lists are empty (in is empty only in case of coinbase TX)
    const inputs = tx.getInputsList();
    if (tx.getNinCount() !== inputs.length) {
      // coinbase has 0 inputs
      this._logger.info(`TX ${hash} invalid - ninCount didn't match actual input count or zero inputs, inputs.length: ${inputs.length}`);
      return false;
    }

    debug(`validingOutputs for ${tx.getHash()}`);
    const validOutputs = await this.validateOutputs(tx, opts.block);
    debug(`validOutputs ${validOutputs} for ${tx.getHash()}`);

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

    // checks the current miners mining pool and the local stored for each of the outputs in the transaction
    // if the key opunspent is not present on ANY of the outpoints in the transaction it is considered valid
    let beingSpent = await this._txPendingPool.isAnyInputSpent(tx, opts.block);
    const indexrebuilt = await this._persistence.get(`${BC_SUPER_COLLIDER}.indexrebuilt`);

    debug({ alreadySpent: beingSpent, hash: tx.getHash() });
    if (beingSpent) {
      if (opts && opts.block && opts.block.getHeight) {
        // TD
        if (indexrebuilt && indexrebuilt === 'complete') {
          return true;
        }
        // TD: since multiple
        this._txPendingPool.markTxsAsMined([tx]);
        this._logger.info(`input is spent for ${tx.getHash()} eval: ${opts.block.getHeight()} <- ${opts.block.getHash()}`);
        return false;
      } else {
        if (indexrebuilt && indexrebuilt === 'complete') {
          return true;
        }
        this._logger.info(`input spent for ${tx.getHash()}`);
        this._txPendingPool.markTxsAsMined([tx]);
        return false;
      }
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
      const referencedTx = opts.referenced && opts.referenced[outpoint.getHash()] ? opts.referenced[outpoint.getHash()] : await this._persistence.getTransactionByHash(outpoint.getHash());
      if (!referencedTx) {
        this._logger.info(`TX ${hash} <- could not find referenced tx blockchain: ${blockchain}, hash: ${outpoint.getHash()}`);
        return false;
      }
      const referencedOutput = referencedTx.getOutputsList()[outpoint.getIndex()];
      if (!referencedOutput) {
        this._logger.info(`TX ${hash} <- could not find referenced output h: ${outpoint.getHash()}, i: ${outpoint.getIndex()}`);
        return false;
      }

      // check if the outpoint value being spent is the same as the original
      if (!new _bn2.default(Buffer.from(outpoint.getValue(), 'base64')).eq(new _bn2.default(referencedOutput.getValue()))) {
        this._logger.info(`TX ${hash} <- outpoint value != referencedOutput value of hash and index- ${outpoint.getHash()}, ${outpoint.getIndex()}`);
        return false;
      }

      if (referencedTx.getLockTime() > latestBlockHeight) {
        this._logger.info(`TX ${hash} <- referenced TX hash ${referencedTx.getHash()} is not mature enough, will be mature at: ${referencedTx.getLockTime()}, latest block height: ${latestBlockHeight}`);
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
        debug(`script did not validate for ${tx.getHash()} ${outpoint.getHash()}:${outpoint.getIndex()}, result: ${result}`);
        return false;
      }
    }
    debug(`${tx.getHash()} is true`);

    return true;
  }

  async isValidTxError(tx, opts) {
    // Check syntactic correctness
    // mind that first step done already by deserializing from protobuf
    debug('isValid() TX hash: %s, %O', tx.getHash(), tx.toObject());

    const blockchain = tx.getId ? tx.getId() : 'bc';
    const hash = tx.getHash();
    let { latestBlockHeight } = opts;

    if (!latestBlockHeight) {
      let latestBlock = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
      latestBlockHeight = latestBlock.getHeight();
    }

    // Make sure neither in or out lists are empty (in is empty only in case of coinbase TX)
    const inputs = tx.getInputsList();
    if (tx.getNinCount() !== inputs.length) {
      // coinbase has 0 inputs
      let err = `TX ${hash} invalid - ninCount didn't match actual input count or zero inputs, inputs.length: ${inputs.length}`;
      this._logger.info(err);
      return { err };
    }

    debug(`validingOutputs for ${tx.getHash()}`);
    const validOutputs = await this.validateOutputsError(tx, opts.block);
    debug(`validOutputs ${validOutputs} for ${tx.getHash()}`);

    if (!validOutputs.success) {
      this._txPendingPool.markTxsAsMined([tx]);
      return { err: validOutputs.err };
    }

    //Ensure Input Value is Greater than Output Value
    try {
      if (calcTxFee(tx).lt(new _bn2.default(0))) {
        let err = `calcTxFee - ${calcTxFee(tx).lt(new _bn2.default(0))}`;
        this._txPendingPool.markTxsAsMined([tx]);
        return { err };
      }
    } catch (err) {
      debug(`err - ${err}`);
      this._txPendingPool.markTxsAsMined([tx]);
      return { err };
    }

    //check if any inputs are already spent or being spent in the txPendingPool
    let beingSpent = await this._txPendingPool.isAnyInputSpent(tx, opts.block);
    debug({ alreadySpent: beingSpent, hash: tx.getHash() });
    if (beingSpent) {
      let err = `input is already being spent for ${tx.getHash()}`;
      debug(err);
      this._txPendingPool.markTxsAsMined([tx]);
      return { err };
    }

    for (let input of inputs) {
      if (input.getScriptLength() !== input.getInputScript().length) {
        let err = `TX ${hash} invalid - input script length didn't match: i: ${input.toObject()}, scriptLength: ${input.getScriptLength()}, actual: ${input.getInputScript().length}`;
        this._logger.info(err);
        return { err };
      }

      // Reject "nonstandard" transactions: scriptSig doing anything other than pushing numbers on the stack, or scriptPubkey not matching the two usual forms[4]
      const inputScript = (0, _bytecode.toASM)(Buffer.from(input.getInputScript()), 0x01);
      if (!_txUtils.ScriptTemplates.validateScript(Buffer.from(input.getInputScript()))) {
        let err = `invalid script format, script: ${inputScript}`;
        this._logger.warn(err);
        return { err };
      }

      const outpoint = input.getOutPoint();
      //const referencedTx = opts.referenced ? opts.referenced[outpoint.getHash()] : await this._persistence.getTransactionByHash(outpoint.getHash())
      const referencedTx = await this._persistence.getTransactionByHash(outpoint.getHash());
      if (!referencedTx) {
        let err = `TX ${hash} invalid - could not find referenced tx blockchain: ${blockchain}, hash: ${outpoint.getHash()}`;
        this._logger.info(err);
        return { err };
      }
      const referencedOutput = referencedTx.getOutputsList()[outpoint.getIndex()];
      if (!referencedOutput) {
        let err = `TX ${hash} invalid - could not find referenced output h: ${outpoint.getHash()}, i: ${outpoint.getIndex()}`;
        this._logger.info(err);
        return { err };
      }

      // check if the outpoint value being spent is the same as the original
      if (!new _bn2.default(Buffer.from(outpoint.getValue(), 'base64')).eq(new _bn2.default(referencedOutput.getValue()))) {
        let err = `TX ${hash} invalid, outpoint value != referencedOutput value of hash and index- ${outpoint.getHash()}, ${outpoint.getIndex()}`;
        this._logger.info(err);
        return { err };
      }

      if (referencedTx.getLockTime() > latestBlockHeight) {
        let err = `TX ${hash} invalid - referenced TX is not mature enough, will be mature at: ${referencedTx.getLockTime()}, latest block height: ${latestBlockHeight}`;
        this._logger.info(err);
        return { err };
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
        let err = `script did not validate for ${tx.getHash()} ${outpoint.getHash()}:${outpoint.getIndex()}, result: ${result}`;
        debug(`script did not validate for ${tx.getHash()} ${outpoint.getHash()}:${outpoint.getIndex()}, result: ${result}`);
        return { err };
      }
    }
    debug(`${tx.getHash()} is true`);

    return { success: true };
  }

  /**
   * Returns true if all TXs valid or array of invalid TX hashes
   *
   * @param possibleTxs {Transaction[]} array of transactions with first assuming to be a coinbase
   */
  async validateTxs(block, parentBlock) {
    // check if any if the txs are trying to spend the same outpoint
    let date = Date.now();
    let possibleTxs = block.getTxsList().slice(1);

    if (!block) {
      return false;
    }

    if (scouts.has(block.getHash())) {
      return true;
    }

    //const consensusBlock = await this._persistence.get(`${block.getHeight()}:${block.getHash()}`)
    //if (consensusBlock) {
    //  return true
    //}

    if (block.getHeight() > 6900000 && block.getHeight() < 6920000) {
      return true;
    }

    let referencedTxs = [];

    for (let tx of possibleTxs) {
      for (const input of tx.getInputsList()) {
        const x = await this._persistence.getTransactionByHash(input.getOutPoint().getHash());
        referencedTxs.push(x);
      }
    }

    //let promises = possibleTxs.reduce((all, tx) => {
    //  return all.concat(tx.getInputsList().map((input) => {
    //    return this._persistence.getTransactionByHash(input.getOutPoint().getHash())
    //  }))
    //}, [])
    //// console.log(`time found took ${Date.now() - date}`)

    //let referencedTxs = await Promise.all(promises)

    referencedTxs = referencedTxs.filter(r => {
      return r != null;
    });

    let referenced = {};
    for (let ref of referencedTxs) {
      if (ref && ref.getHash) referenced[ref.getHash()] = ref;
    }

    let validTxs = [];

    for (const tx of possibleTxs) {
      const t = await this.isValidTx(tx, { referenced, block, latestBlockHeight: block.getHeight() });
      if (t) {
        validTxs.push(t);
      }
    }

    return validTxs.reduce((all, curr) => {
      return all && curr;
    }, true);
  }
}
exports.TxHandler = TxHandler;