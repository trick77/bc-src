'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TxHandler = undefined;

var _bn = require('bn.js');

var _bn2 = _interopRequireDefault(_bn);

var _ramda = require('ramda');

var _logger = require('../logger');

var _core_pb = require('@overline/proto/proto/core_pb');

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
          let [makerScript, b, makerOutput] = await this._persistence.getInitialMakerOrder(outputScript);
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

    //check if any inputs are already spent or being spent in the txPendingPool
    let beingSpent = await this._txPendingPool.isAnyInputSpent(tx);
    debug({ alreadySpent: beingSpent, hash: tx.getHash() });
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
        debug(`script did not validate for ${tx.getHash()} ${outpoint.getHash()}:${outpoint.getIndex()}, result: ${result}`);
        return false;
      }
    }
    debug(`${tx.getHash()} is true`);

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

    if (!block) {
      return false;
    }
    let scouts = new Set(['00be539c6d9eebccfb37d3cdee7f23ecc63d6e69e39ffef1070134a6324d050d', '744d77e46c123bfaafc1ebd4671c79679ca819ab09665b1f04e2c11417a6a48f', 'e3c668d5eac9384583c5dafc234c1eac139fcce8f4e3f11946bb1561431ed139', '512502137fe4e14bcb098a1d6a0d0395df036870d433eb1b313631559c9d8d0c', 'c96a3b7d36cc83a84c416fff6c76f3791d44224b307e103c41940d1f59cf3ffe', '29090a964c56107a84820bf5caf70a629e5ada8337220c8b1a61acc2269e91e0', 'f7f1f845e7aeb41f6929900eaf8eda0911932785c9831065f80b4e2574527b68', 'b24263d12b0c48cd16be2e089c0beb07795f4b1fc83205f5bb44429a0145de72', '49699e566a0262d000644d44249566432e6b490bb0e91f2d31f3dc69f9060e4c', '101f865e7270f1fc4b6551d0a64fb48ae3b76b611dbc748bc3c7b66762f1e858', 'f6a7a72e36803fb7fedf09dc2ddc471db5c12ed0f2df7e403bb9c3526f838d7d', 'aba220b8225b4e32771cd65f4d90ba7b8c5a19f9e97517adb361251cd5d50337', '49f7a97b434c3935c182845960ebd98331522d72fabfe01fe6d15d185adfef66', 'bc8f395d6b61d390867852bd0285d0f0b1db4cbb499439349699b4b4d5b0ce50', '665367bf11800dec4ac4057a5c78dbdfa4f6caa925eaae48ce51680d29fc5bec', '196e92a80496cead4ce0bbb37aaa6a149f9abf2867c508a0fef225c9e7879484', '9fea92a6de565e8e9f3c8e97885b43ddccc42c652603c398d503262e35bd0ef1', '88fbc8627a70f0767a997047f8c70a0859d826334d82b3507066875b244b9fc7', '28a0b2011dc915c42015713386ecc9cd1440bc30b563f10993b43e6ba1845e74', '21ca81cd0349d4b9acf4f40185bb714f70b5c31a97f469770dae1bc04d8a6ade', 'be6a2023cbcc453dae8c6aaf573c9a17bbf23d9a8cea1b8682bb9d0572a2819c', '820af8ffb68b04d2fbb109b3a0636486e85e960f061e9c7df784cfdd0d7c60b0', '7daa7d5264608c0f28c7b01fe1e8b76b8df966c6dbd09d35c96441523438a292', 'd89ca974507196b645367f852b40b514610a3859c344fd60842e0014e8ec4dff', 'b9b531ea95215b7e307c73fcb8169355363123f3d75d2344207ca2bc98fcbbed', '59656013b2c5ec3c2c6af22029ac4f8da54c96ab0bc9b5d5568b61020b275a7d', '63b89ffd54586dc2441cff425fb2a6f6bd8e062910118b053881c4cdb381d446', '28f4596374000323d88d8fbd76e12b8d1256b4b8239ed54fa272d5b80dd38200', '684ec223c6b50fd2b6f73c771c2fe5a71158c6f2f8315dffbc43fe04fa5cc32b', '51862d0af4fe5daefa598e94f83a382c9b82c9f0f8284f1893d04709e4f6cf23', 'b6b4010f7476361f3c773a402d4a2502ba935032e0aaabf5a60ac27c314ca654', '7a57487c9472ba16248c6158a3d018a3566eb06fc1ef9995099f7bc1ecd2692e', '3f29b8913a873711030b6f576bfafc0c8470e56018e9ea8bb45d4e96c75700f8', '0e234d2f797fb8eb3a2520a9619e71252712f5f31a425b2e95d5d0f649918b53', '243a3b22d50a8f8002241acbc4b46e70a9a8d064df91cb308ad02eb11b183eb8', '5cf5bd4c978699ffecc660b12e7a4346cef8ba13c1eef6856b2ee6a9e697e8d7', '52296437a32d82d372f062932f7690387a6c67e89b3eb83f01595a7955bd849d', '176b76b3421b59ca14e4b21afe88dd487c80c924c0439101fc3d2f9f955bf93b', '8cb1484899825a1ad3ec18ef8cec99452dc7236d12645787bbab5de87e164cd3', 'f84a4ea196c752fb069593bc4740d358dad8470d187fe732ccd23371d24d613a', 'ea50badab352a567c109bd14ed025b5dcd0dfbf756a19a5c2f9c082a506a8127', '24cbf7ed78e4e29127f09196e873002c1ad2b56e3fb79ce308bf63eb188d3ff4', '809ad6576dbffa19958e2e30c2cb14c67d2003ee60964a527777a518319688f4', '932897f0443096940abdd53cfcd7b9526f08cc4dd490d2e25f47adabcd49fbb2', '7ddb69cc8fd308e8eee966a6576dfb559e39ff2923bdd3f0c2d014453b4547ca', 'a2100ee8f35735d3fb36d480ada4e24b05a574194e44baa5d3917c8c82c16f47', 'dfbdffd6bccf8fbb93f154e8842c3e3e73b07afc45820ca21cc03513902385dc', '84148528d7b2dbd7242aaec96ebe1b6799fa04eb196fd8cb8458a9f1d8f2f121', 'c994320f3ed5fdfce1fcbb835f003192497a350361c37d357c271f4782f6b341', 'e987a3c0dc915717777e8214ad43e98bec674320bcaa95c5ca9b28ed1dd379bf', '5d2be3d4638b16a71028319851bff75b06f7991b2e93eba506bfadcfd493bb2e']);

    if (scouts.has(block.getHash())) {
      return true;
    }

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
      if (ref && ref.getHash) referenced[ref.getHash()] = ref;
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