'use strict';

var _ramda = require('ramda');

var _bytecode = require('bcjs/dist/script/bytecode');

var _decimal = require('decimal.js');

/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
// const { Block, BcBlock, Transaction, TransactionOutput, TransactionInput } = require()
var { parser } = require('./script');
var Validator = require('./validator');
var BeamToJson = require('./beamtojson');
var BN = require('bn.js');
const { getScriptType, ScriptType } = require('bcjs/dist/script/templates');
const {
  ScriptTemplates,
  generateDataToSignForSig,
  parseTakerUnlockScript,
  parseMakerLockScript
} = require('../core/txUtils');
const { internalToHuman, Currency, CurrencyInfo, COIN_FRACS: { NRG } } = require('../core/coin');
const { blake2bl } = require('../utils/crypto');
var debug = require('debug')('bcnode:script:interpreter');
var LRUCache = require('lru-cache');

class Interpreter {

  constructor(persistence, utxoManager) {
    this.persistence = persistence;
    this.utxoManager = utxoManager;
    this.latestBlock = false;
    this.blockCache = new LRUCache({
      max: 200
    });
    this.txCache = new LRUCache({
      max: 10000
    });
    this.scriptCache = new LRUCache({
      max: 10000
    });
  }
  /* create reference dictionary of monads
   * @param {string} script
   * @param {Object} env
   * @return {Object} table of monads
   */
  getMonadTable(script, env) {
    if (script.indexOf('OP_MONAD') > -1) {
      const monadStrings = script.match(/(?<=OP_MONAD\s+).*?(?=\s+OP_ENDMONAD)/gs);
      // console.log({script,monadStrings});
      const res = script.split(' OP_MONAD ').reduce((all, p, i) => {
        if (i < 1) {
          all.script = p;
        } else {
          p = p.split('OP_ENDMONAD');
          all.script = all.script + ' ' + i + ' OP_MONAD ' + p[1];
          all.table[i] = monadStrings.shift();
        }
        return all;
      }, { script: '', table: {} });
      res.script = res.script.replace(/\sOP_ENDMONAD/g, '');
      return res;
    }
    return false;
  }
  /* get relevant marked operations from the cache
   * @param {string} script
   * @param {BcBlock} bc block
   * @return {Array} list of marked transactions
   */
  async getScriptMarkedTxs(script, env) {
    var markedOperations = Validator.includesMarkedOpcode(script);
    // if there are no marked operations return an empty array
    if (markedOperations.length === 0) {
      return markedOperations;
    } else if (script.indexOf('OP_MARK') > -1) {
      var mark = BeamToJson.toJSON('OP_MARK', script);
    } else if (script.indexOf('OP_MAKERCOLL') > -1) {
      debug(`grabbed marked txs for ${env.OUTPOINT_HASH}.${env.OUTPOINT_INDEX}`);
      //TODO rework validation script
      // if (ScriptTemplates.validateScript(script)) {
      let markedTxs = await this.utxoManager.getMarkedTxsForMatchedTx(env.OUTPOINT_HASH, env.OUTPOINT_INDEX, env.LATEST_BLOCK);
      return markedTxs;
      // }
    }
  }

  getTakerInputScript(inputs) {
    for (let rInput of inputs) {
      const is = rInput.getInputScript();
      if (this.scriptCache.has(is)) {
        return this.scriptCache.get(is);
      }
      const inputScript = (0, _bytecode.toASM)(Buffer.from(rInput.getInputScript()), 0x01);
      if (inputScript.split(' ').length === 2) {
        this.scriptCache.set(is, inputScript);
        return inputScript;
        break;
      }
    }
  }

  /* env object delvered
   * {
   *   SCRIPT
   *   LATEST_BLOCK
   *   OUTPOINT_OWNER
   *   OUTPOINT_HASH
   *   OUTPOINT_INDEX
   *   OUTPOINT_TX
   *   OUTPOINT_TX_BLOCK
   *   CALLBACK_HASH
   *   CALLBACK_INDEX
   *   CALLBACK_TX
   *   CALLBACK_TX_BLOCK
   *   CALLBACK_LOCAL_OUTPUTS
   *   INPUT_TX_BLOCK
   *   INPUT_TX --------- transaction containing the provided input
   * }
   * @param outputScript string script to to be unlocked
   * @param inputScript string script to unlock outputScript
   * @return Object
   */
  async getScriptEnv(outputScript, inputScript, input, tx, block) {
    try {
      var env = {
        SCRIPT: inputScript + ' ' + outputScript,
        LATEST_BLOCK: false,
        OUTPOINT_OWNER: false,
        OUTPOINT_HASH: false,
        OUTPOINT_INDEX: 0,
        OUTPOINT_TX: false,
        OUTPOINT_TX_BLOCK: false,
        CALLBACK_TX: false,
        CALLBACK_TX_BLOCK: false,
        CALLBACK_LOCAL_OUTPUTS: false,
        INPUT_TX: false,
        INPUT_TX_BLOCK: block ? block : false,
        MARKED_TXS: [],
        SETTLED: false,
        CALLBACK_HASH: undefined,
        CALLBACK_INDEX: undefined,
        MONADS: false,
        /*
         * Address space human readable 'X' change for the hex equivalent
         *
         *  0: FIX Protocol
         *  1: MSC2010 + Vanity Addresses
         *  2: XMLRPC Protocol
         *  3: Super Collider + Enterprise
         *  4: RESERVED
         *  5: RESERVED
         *  6: Local Government
         *  7: GEO Coordinates
         *  8: NA
         *  9: Emergency Services
         *  10: NA
         */
        X: {
          '0': {},
          '1': require('./data/x1_msc2010.json'),
          '2': require('./data/x2_game_engine_v1.json'),
          '3': {},
          '4': {},
          '5': {},
          '6': {},
          '7': {},
          '9': {},
          '10': {}
        }
      };
      const blockchain = tx.getBlockchain !== undefined ? tx.getBlockchain() : 'bc';
      env.OUTPOINT_HASH = input.getOutPoint().getHash();
      if (env.OUTPOINT_HASH === undefined || env.OUTPOINT_HASH.length < 64) {
        return false;
      }
      env.OUTPOINT_INDEX = input.getOutPoint().getIndex();
      env.OUTPOINT_TX_BLOCK = await this.getBlockForTxHash(env.OUTPOINT_HASH, blockchain);
      if (env.OUTPOINT_TX_BLOCK === false) {
        throw new Error(`unable to load referenced block containing tx ${env.OUTPOINT_HASH} of outpoint`);
      }

      // !!! IMPORTANT !!!
      // the input tx block will not be available if the block in question is the latest block
      if (!env.INPUT_TX_BLOCK) env.INPUT_TX_BLOCK = await this.getBlockForTxHash(tx.getHash(), blockchain);

      env.LATEST_BLOCK = block;
      // console.log(`evaluating tx within ${block.getHeight()}`)
      // console.log({block})
      // this.blockCache.set(`${blockchain}.block.${env.LATEST_BLOCK.getHash()}`, env.LATEST_BLOCK)
      _decimal.Decimal.set({ toExpPos: 100 });
      _decimal.Decimal.set({ toExpNeg: -100 });

      env.INPUT_TX = tx;

      // loads the entire tx in question for the output
      env.OUTPOINT_TX = await this.getTx(env.OUTPOINT_HASH, blockchain);

      let outScript = env.OUTPOINT_TX.getOutputsList()[env.OUTPOINT_INDEX].getOutputScript();

      if (getScriptType(outScript) === 'maker_output') {
        let { base } = parseMakerLockScript((0, _bytecode.toASM)(Buffer.from(outScript), 0x01));
        env.BASE = base;
        env.RATIO = new _decimal.Decimal(1);
        env.IS_MAKER = true;
      }

      // Trying to unlock a taker order (input = _createNRGOutputLockScript, output = _makerTxHash, _makerTxIndex _OPCALLBACK, 4, OP_IFEQ, ....)
      if (Validator.includesCallbackOpcode(outputScript) === true && env.SCRIPT.indexOf('OP_MONOID') < 0 === true) {

        const takerInfoAddresses = this.getTakerInputScript(env.OUTPOINT_TX.getInputsList());

        const [callbackScript, callbackHeight, callbackTx, callbackTxIndex] = await this.utxoManager.getInitialMakerOrderWithTxAndIndex(outputScript);
        var remainingScript = outputScript.slice(outputScript.indexOf('OP_CALLBACK') + 'OP_CALLBACK'.length + 1, outputScript.length);

        // the monoid (makers) tx hash
        env.CALLBACK_HASH = callbackTx.getHash();
        env.CALLBACK_INDEX = callbackTxIndex;
        env.CALLBACK_TX = callbackTx;
        env.CALLBACK_TX_BLOCK = await this.getBlockForTxHash(callbackTx.getHash(), blockchain);

        // CALLBACK_TX is the monoid maker tx
        if (env.CALLBACK_TX !== null && env.CALLBACK_TX !== false) {
          const callbackOutput = env.CALLBACK_TX.getOutputsList()[callbackTxIndex];

          //used to calculate the amount of the order the taker took
          const numer = new _decimal.Decimal(internalToHuman(callbackOutput.getValue(), NRG));
          const denom = new _decimal.Decimal(internalToHuman(env.OUTPOINT_TX.getOutputsList()[env.OUTPOINT_INDEX].getValue(), NRG));
          env.RATIO = denom.div(numer);

          if (callbackScript.indexOf('OP_MONOID') === 0) {

            let { base } = parseMakerLockScript(callbackScript);
            env.BASE = base;

            outputScript = callbackScript.replace('OP_MONOID', '') + ' ' + remainingScript;
            env.SCRIPT = inputScript + ' ' + takerInfoAddresses + ' ' + outputScript;
            env.SCRIPT = env.SCRIPT.replace(/  +/g, ' ');

            // calculate settlement params
            let isWithinSettlement = await this.utxoManager.isTxWithinSettlement(env.OUTPOINT_HASH, env.OUTPOINT_INDEX, env.LATEST_BLOCK);
            env.SETTLED = !isWithinSettlement;

            debug('2%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%');
            debug(env.SCRIPT);
          } else {
            throw new Error('callback referenced script does not contain monadic property');
          }
        } else {
          throw new Error('unable to recover script referenced callback');
        }
      } else if (Validator.includesCallbackOpcode(outputScript)) {
        throw new Error('script contains monoid and callback');
      } else {
        //unlocking a maker order, check if past settlement period
        // console.log(`unlocking a maker order - ${env.OUTPOINT_HASH}:${env.OUTPOINT_INDEX}`);
        let isWithinSettlement = await this.utxoManager.isTxWithinSettlement(env.OUTPOINT_HASH, env.OUTPOINT_INDEX, env.LATEST_BLOCK, true);
        env.SETTLED = !isWithinSettlement;
      }

      // Assert monoid isomorphism
      await this.assertMonoidIsomorphishm(env);

      // !!! IMPORTANT !!!
      // When creating scripting environment marked transactions must be calculated last
      env.MARKED_TXS = await this.getScriptMarkedTxs(env.SCRIPT, env);
      env.MONADS = this.getMonadTable(env.SCRIPT, env);
      // if monads have been detected inject pointers to their locations
      env.SCRIPT = env.MONADS ? env.MONADS.script : env.SCRIPT;
      // console.log({env})
      // console.log({script:env.SCRIPT});
      return env;
    } catch (err) {
      console.error('errrrr', err);
      return false;
    }
  }

  async getTx(txHash, blockchain) {
    if (this.txCache.has(txHash)) {
      return this.txCache.get(txHash);
    } else {
      const tx = await this.persistence.getTransactionByHash(txHash, blockchain);
      this.txCache.set(txHash, tx);
      return tx;
    }
  }

  async assertMonoidIsomorphishm(env) {
    if (env.SCRIPT.indexOf('OP_MONOID') > -1) {
      const inputs = env.INPUT_TX.getInputsList();
      // scan through inputs and check for OP_MONOID the script of their outpoint
      const monoidIso = {
        forceFail: false,
        spendMonoidInputs: [],
        readTxs: []
      };
      for (var i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const op = input.getOutPoint();
        // need to look at each input uniquely for hash and index of outpoint
        if (!(op.getHash() + op.getIndex() in monoidIso.readTxs)) {
          monoidIso.readTxs[op.getHash() + op.getIndex()] = input;
          const optx = await this.getTx(op.getHash(), 'bc');
          if (optx === null || optx === false) {
            // if the transaction referenced does not exist fail
            monoidIso.forceFail = true;
          } else {
            const refop = optx.getOutputsList()[op.getIndex()];
            const s = (0, _bytecode.toASM)(Buffer.from(refop.getOutputScript()), 0x01);
            if (s.indexOf('OP_MONOID') > -1) {
              monoidIso.spendMonoidInputs.push(input);
            }
          }
        }
      }

      if (monoidIso.forceFail) {
        throw new Error('force failed isomorphism -> unable to load outpoint script from disk');
      } else if (monoidIso.spendMonoidInputs.length > 1) {
        throw new Error('failed isomorphism assertion -> multiple monoids in inputs');
      } else if (monoidIso.spendMonoidInputs.length === 0) {
        throw new Error('failed isomorphism assertion -> monoid not found in outpoints');
      }
    }
  }

  async getBlockForTxHash(txHash, blockchain) {
    // determine the key of the block in reference
    // var txBlockKey = `${blockchain}.txblock.${txHash}`

    // if (this.blockCache.has(txBlockKey)) {
    //   return this.blockCache.get(txBlockKey)
    // } else {
    let block = await this.persistence.getBlockByTxHash(txHash, blockchain);
    if (block) {
      // this.blockCache.set(txBlockKey, block)
      return block;
    } else return false;
    // }
  }

  /**
   * loads environment asynchronously before parsing script
   * @param script string Script to evaluate
   * @param input TranactionInput
   * @param tx Transaction|MarkedTransaction
   * @returns Promise<Object>
   */
  // const res = await interpreter.parseAsync(
  //   parentOutputScript, childInputScript, childInput, childTx, false)
  async parseAsync(outputScript, inputScript, input, tx, allowDisabled, block) {

    var script = inputScript + ' ' + outputScript;
    if (!allowDisabled && Validator.includesDisabledOpcode(script)) {
      throw new Validator.DisabledOpcodeException(script);
    }
    const dataToSign = generateDataToSignForSig(input.getOutPoint(), tx);

    if (!Validator.includesAsyncOpcode(script)) {
      return Promise.resolve(this.parse(dataToSign, script, allowDisabled));
    }

    try {
      // get context of the transaction
      parser.yy.env = await this.getScriptEnv(outputScript, inputScript, input, tx, block);
      script = parser.yy.env.SCRIPT;
      // console.log({script,dataToSign});
      return this.parse(dataToSign, script);
    } catch (e) {
      debug(e);
      return {
        code: null,
        value: false,
        error: e
      };
    }
  }

  parse(dataToSign, wholeScript, allowDisabled) {
    if (!allowDisabled && Validator.includesDisabledOpcode(wholeScript)) {
      throw new Validator.DisabledOpcodeException(wholeScript);
    }

    const scriptWithDataToSignHash = blake2bl(dataToSign) + ' ' + wholeScript;

    try {
      const res = parser.parse(scriptWithDataToSignHash);
      return res;
    } catch (e) {
      console.error('error', e);
      return {
        code: null,
        value: false,
        error: e
      };
    }
  }

  evaluate(dataToSign, wholeScript, allowDisabled = false) {
    const res = this.parse(dataToSign, wholeScript, allowDisabled);
    debug(res.value);
    debug(res.code);
    debug(res.error);
    return res.value;
  }

  /**
   * returns a boolean after evaluating the provided script
   * @param script string Script to evaluate
   * @param input string TranactionInput
   * @param tx Transaction|MarkedTransaction
   * @returns Promise<boolean>
   */
  async evaluateAsync(outputScript, inputScript, input, tx, allowDisabled, block) {
    try {
      const res = await this.parseAsync(outputScript, inputScript, input, tx, allowDisabled, block);
      return res.value;
    } catch (e) {
      debug(e);
      return false;
    }
  }

  unlock(outputLockScript, inputUnlockScript, dataToSign, allowDisabled) {
    return this.evaluate(dataToSign, inputUnlockScript + ' ' + outputLockScript, allowDisabled);
  }
}

module.exports = Interpreter;