'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});


const keccak = require('keccak'); /**
                                   * Copyright (c) 2018-present, BlockCollider developers, All rights reserved.
                                   *
                                   * This source code is licensed under the MIT license found in the
                                   * LICENSE file in the root directory of this source tree.
                                   *
                                   * 
                                   */

const debug = require('debug')('bcnode:txutils');
const debugEmb = require('debug')('bcnode:txutils:emb');
// const { randomBytes } = require('crypto')
const { intToBuffer, bufferToInt } = require('../utils/buffer');
const secp256k1 = require('secp256k1');
const BN = require('bn.js');
const { overlineDistance, createMerkleRoot } = require('../mining/primitives');
const { blake2bl } = require('../utils/crypto');
const { isHexString, normalizeHexString } = require('bcjs/dist/utils/string');
const { calcTxFee } = require('bcjs/dist/transaction');
const { humanToBN, internalToBN, internalToHuman, MAX_NRG_VALUE, COIN_FRACS: { NRG, BOSON }, Currency } = require('./coin');
const { Transaction, TransactionOutput, OutPoint, TransactionInput } = require('@overline/proto/proto/core_pb');
const { toASM, fromASM } = require('bcjs/dist/script/bytecode');
const {
  createNRGLockScript,
  createMakerLockScript,
  createTakerCallbackLockScript,
  createTakerLockScript,
  createTakerUnlockScript,
  parseNRGLockScript: sdkParseNRGLockScript,
  parseMakerLockScript: sdkParseMakerLockScript,
  parseTakerUnlockScript: sdkParseTakerUnlockScript,
  parseTakerLockScript: sdkParseTakerLockScript,
  getScriptType,
  ScriptType
} = require('bcjs/dist/script/templates');
const { ROVER_SECONDS_PER_BLOCK } = require('../rover/utils');
const SECONDS_72H = 72 * 60 * 60;

const toBuffer = require('to-buffer');

const roundToFive = num => {
  return +(Math.round(num + "e+5") + "e-5");
};

/* CONSENSUS TX STATIC VALUES */
// 64000-155000 tx in tx panels per block (12800 TPS)
// 220 byte size on TX 109 compressed
// FIX protocol independent and secondary nodes
// 21209378917571
const MAX_TXDIST_BLOCK = exports.MAX_TXDIST_BLOCK = 1413958594504736;
const HALF_MAX_TXDIST_BLOCK = exports.HALF_MAX_TXDIST_BLOCK = 706979297252368;
const BASE_TX_DISTANCE_BLOCK = exports.BASE_TX_DISTANCE_BLOCK = 21809378917576;
const BASE_BLOCK_SIZE = exports.BASE_BLOCK_SIZE = 33600;
const COINBASE_TX_ESTIMATE_SIZE = exports.COINBASE_TX_ESTIMATE_SIZE = 256;
const BC_COINBASE_MATURITY = exports.BC_COINBASE_MATURITY = process.env.BC_COINBASE_MATURITY ? Number(process.env.BC_COINBASE_MATURITY) : 100;
const BC_MINER_KEY = exports.BC_MINER_KEY = process.env.BC_MINER_KEY;
const BC_WIRELESS_WEIGHT = exports.BC_WIRELESS_WEIGHT = 3;
const MINIMUM_EMBLEM_TO_NRG = exports.MINIMUM_EMBLEM_TO_NRG = 6757;
const NRG_BLOCK_GRANT = exports.NRG_BLOCK_GRANT = 2;
const TX_DEFAULT_NONCE = exports.TX_DEFAULT_NONCE = '33e9fa317308a1e0002a65d650e27439fc046a8a14ae1862cb91f231bbc6d18f';
const EMBLEM_GOLD_BCI_BLOCK = exports.EMBLEM_GOLD_BCI_BLOCK = 66000000;
const EMBLEM_GOLD_WINDOW = exports.EMBLEM_GOLD_WINDOW = 260000;

// const EMBLEM_INPUT_TX_MAX = 5

// allowes to lock until height of ~ 2.815 * 10^14
// should be enough within next ~45755790 years assuming block time = 5s
const MAX_HEIGHT_HEX_LENGTH = 16;

class ScriptTemplates {
  static validateScript(script) {
    debug('switch(getScriptType()): %o', getScriptType(script));
    switch (getScriptType(script)) {
      case ScriptType.MAKER_OUTPUT:
        return ScriptTemplates.validateMakerOutputScript(toASM(script, 0x01));

      case ScriptType.FEED_CREATE:
        return true;

      case ScriptType.FEED_UPDATE:
        return true;

      case ScriptType.TAKER_CALLBACK:
        return ScriptTemplates.validateTakerCallbackScript(toASM(script, 0x01));

      case ScriptType.TAKER_OUTPUT:
        return ScriptTemplates.validateTakerOutputScript(toASM(script, 0x01));

      case ScriptType.NRG_TRANSFER:
        return ScriptTemplates.validateNRGLockScript(toASM(script, 0x01));

      case ScriptType.TAKER_INPUT:
        // validate output of createSignedNRGUnlockScripts && createTakerUnlockScript
        const parts = toASM(script, 0x01).split(' ');
        if (parts.length !== 3 && parts.length !== 2) {
          // taker's input script see bcjs's script/templates#createSignedNRGUnlockInputs
          return false;
        }
        return true;

      default:
        console.log(getScriptType(script));
        throw new Error('Unknownt script type, cannot validate');
    }
  }

  static validateOutput(output, block) {
    debug('switch(getScriptType()): %o', getScriptType(Buffer.from(output.getOutputScript())));
    switch (getScriptType(Buffer.from(output.getOutputScript()))) {
      case ScriptType.MAKER_OUTPUT:
        return ScriptTemplates.validateMakerOutput(output, block);

      case ScriptType.TAKER_OUTPUT:
      case ScriptType.TAKER_INPUT:
      case ScriptType.TAKER_CALLBACK:
      case ScriptType.FEED_CREATE:
      case ScriptType.FEED_UPDATE:
      case ScriptType.NRG_TRANSFER:
        return true;

      default:
        throw new Error('Unknown script type, cannot validate');
    }
  }

  /*
   * NRG Balance Transfer - output
   * Sends NRG from one addess to another
   */
  static validateNRGLockScript(script) {
    const parts = script.split(' ').map(p => p.startsWith('0x') ? p.slice(2) : p);

    if (parts.length !== 4) {
      debug(`validateNRGLockScript() 0 - l: ${parts.length}`);
      return false;
    }

    // last 5 tokens are the same
    const [opBlake, bcAddress, opEqV, opChecksigV] = parts;
    if (opBlake !== 'OP_BLAKE2BLC' && opBlake !== 'OP_BLAKE2BLPRIV' && opBlake !== 'OP_BLAKE2BLS') {
      debug(`validateNRGLockScript() 1 - op: ${opBlake} unsupported hashing function`);
      return false;
    }

    if (opBlake !== 'OP_BLAKE2BLPRIV') {
      debug(`validateNRGLockScript() 1 - op: ${opBlake}`);
      return false;
    }

    if (bcAddress.length !== 64 || !isHexString(bcAddress)) {
      debug(`validateNRGLockScript() 2 - bcAddress: ${bcAddress}`);
      return false;
    }

    if (opEqV !== 'OP_EQUALVERIFY') {
      debug(`validateNRGLockScript() 3 - op: ${opEqV}`);
      return false;
    }

    if (opChecksigV !== 'OP_CHECKSIGNOPUBKEYVERIFY') {
      debug(`validateNRGLockScript() 4 - op: ${opChecksigV}`);
      return false;
    }

    return true;
  }

  /*
   * see bcjs's script/templates createMakerLockScript
   */
  static validateMakerOutputScript(script) {
    const parts = script.split(' ');

    if (parts.length !== 62 && parts.length !== 56) {
      debug(`validateMakerOutputScript() 0 - parts.length: ${parts.length}`);
      return false;
    }
    debug('parts %O', parts);

    const isNRGTrade = parts.length === 56;
    debug('validateMakerOutputScript() isNRGTrade = %o', isNRGTrade);

    try {
      const {
        shiftMaker,
        shiftTaker,
        deposit,
        settlement,
        sendsFromChain,
        receivesToChain,
        sendsFromAddress,
        receivesToAddress,
        sendsUnit,
        receivesUnit,
        doubleHashedBcAddress,
        fixedUnitFee,
        base
      } = parseMakerLockScript(script);

      const reConstructedOutputScript = createMakerLockScript(shiftMaker, shiftTaker, deposit, settlement, sendsFromChain, receivesToChain, sendsFromAddress, receivesToAddress, sendsUnit, receivesUnit, base === 2 ? '' : fixedUnitFee, doubleHashedBcAddress, true);

      if (reConstructedOutputScript !== script) {
        debug(`validateMakerOutputScript() 2 - reConstructedOutputScript !== script:\n${reConstructedOutputScript}\n${script}`);
        return false;
      }

      if (isNRGTrade) {
        if (shiftMaker !== 0) {
          debug(`validateMakerOutputScript() 3 - shiftMaker for NRG !== 0: ${shiftMaker}`);
          return false;
        }
      } else {
        if (shiftMaker < 0) {
          debug(`validateMakerOutputScript() 3 - shiftMaker < 0: ${shiftMaker}`);
          return false;
        }
      }

      if (shiftTaker < 0 || deposit < 0 || settlement < 0) {
        debug(`validateMakerOutputScript() 4 - ${shiftTaker}, ${deposit}, ${settlement}`);
        return false;
      }

      const validChains = ['btc', 'eth', 'lsk', 'wav', 'neo', 'dai', 'emb', 'usdt', 'xaut', 'wbtc', 'uni', 'wise', 'frax', 'ust', 'link', 'usdc', 'core', 'dpi', 'hez', 'bond', 'mkr', 'ampl', 'bac', 'lon', 'alpha', 'sdt', 'duck', 'pols', 'exrd', 'tusd', 'lrc', 'ddim', 'cel', 'cc10', 'crv', 'tru', 'xor', 'yfi', 'snx', 'rook', 'pbtc35a', 'pickle', 'farm', 'grt', 'combo', 'orn', 'perp', 'ankreth', 'fnk', 'ren', 'onx', 'apy', 'comp', 'bao', 'omg', 'cvp', 'yfdai', 'stake', 'ramp', 'sand', 'keep', 'mph', 'renbtc'];

      if (isNRGTrade) {
        if (base !== 1) {
          debug('validateMakerOutputScript() 5 - base is 1 in NRG trade');
          return false;
        }

        if (sendsFromChain !== 'nrg') {
          debug(`validateMakerOutputScript() 6 - sendsFromChain for NRG trade not valid: ${sendsFromChain}`);
          return false;
        }

        // BC address length = 64b blake2bl + 0x at start
        // if (sendsFromAddress.length !== 66 && !isHexString(sendsFromAddress)) {
        //   debug(
        //     'validateMakerOutputScript() 7 - sendsFromAddress for NRG trade not valid: %o, %o, %o',
        //     sendsFromAddress, sendsFromAddress.length, isHexString(sendsFromAddress)
        //   )
        //   return false
        // }
      } else {
        if (base === 2 && fixedUnitFee !== '0') {
          debug(`validateMakerOutputScript() 5 - base is 2 and fixedUnitFee ${fixedUnitFee} !== 0`);
          return false;
        }

        if (!validChains.includes(sendsFromChain)) {
          debug(`validateMakerOutputScript() 6 - sendsFromChain not valid: ${sendsFromChain}`);
          return false;
        }
      }

      if (!validChains.includes(receivesToChain)) {
        debug(`validateMakerOutputScript() 8 - receivesToChain not valid: ${receivesToChain}`);
        return false;
      }
    } catch (e) {
      debug(`validateMakerOutputScript() 1 - caught error ${e.stack}`);
      return false;
    }

    return true;
  }

  static validateMakerOutput(output, block) {
    const unit = new BN(Buffer.from(output.getUnit()));
    const value = new BN(Buffer.from(output.getValue()));
    debug({ unit: unit.toString(10), value: value.toString(10) });
    const rem = value.mod(unit);
    const ratioBN = value.div(unit);

    if (!rem.eq(new BN(0))) {
      debug(`validateMakerOutput() 0 - value % unit != 0, but ${rem.toString()}`);
      if (block.getHeight() > 5200000) return false;
    }

    const script = toASM(Buffer.from(output.getOutputScript()), 0x01);
    const parts = script.split(' ').map(p => p.startsWith('0x') ? p.slice(2) : p);

    if (parts.length !== 62 && parts.length !== 56) {
      debug(`validateMakerOutput() 0 - parts.length: ${parts.length}`);
      return false;
    }
    const {
      shiftMaker,
      shiftTaker,
      settlement,
      sendsFromChain,
      receivesToChain,
      sendsUnit,
      receivesUnit
    } = parseMakerLockScript(script);
    let receivesUnitAsMinimumBN = new BN(receivesUnit);
    let sendsUnitAsMinimumBN = new BN(sendsUnit);

    debug(`checking output for block height ${block.getHeight()}`);
    if (block && block.getHeight && parseInt(block.getHeight()) <= 1500000) {
      receivesUnitAsMinimumBN = Currency.toMinimumUnitAsBN(receivesToChain, receivesUnit, receivesToChain);
      sendsUnitAsMinimumBN = Currency.toMinimumUnitAsBN(sendsFromChain, sendsUnit, sendsFromChain);
    }

    const takerSettledInSeconds = (shiftTaker + settlement) * ROVER_SECONDS_PER_BLOCK.bc;
    if (takerSettledInSeconds > SECONDS_72H) {
      debug(`validateMakerOutput() 1 - taker settlement period is longer than ${SECONDS_72H / 60 / 60}h`);
      return false;
    }

    const makerSettledInSeconds = (shiftMaker + settlement) * ROVER_SECONDS_PER_BLOCK.bc;
    if (makerSettledInSeconds > SECONDS_72H) {
      debug(`validateMakerOutput() 2 - maker settlement period is longer than ${SECONDS_72H / 60 / 60}h`);
      return false;
    }

    const isNRGTrade = parts.length === 56;
    debug('validateMakerOutput() isNRGTrade = %o', isNRGTrade);

    if (isNRGTrade) {
      if (!new BN(sendsUnit).eq(value)) {
        debug(`validateMakerOutput() 3 - sendsUnit in NRG trade !== value, sendsUnit: ${sendsUnit}, value: ${value.toString()}`);
        return false;
      }

      if (receivesUnitAsMinimumBN.lt(new BN(0))) {
        debug(`validateMakerOutput() 4 - NRG trade receivesUnit < 0, receivesToChain: ${receivesToChain} receivesUnit: ${receivesUnit}`);
        return false;
      }

      if (!receivesUnitAsMinimumBN.mod(ratioBN).eq(new BN(0))) {
        debug(`validateMakerOutput() 5 - receivesUnitAsMinimumBN: ${receivesUnitAsMinimumBN.toString()}, ratio: ${ratioBN.toString()}`);
        return false;
      }
    } else {
      if (!sendsUnitAsMinimumBN.gt(new BN(0))) {
        debug(`validateMakerOutput() 3 - sendsUnit is < 0, sendsFromChain: ${sendsFromChain} sendsUnit: ${sendsUnit}`);
        return false;
      }

      if (receivesUnitAsMinimumBN.lt(new BN(0))) {
        debug(`validateMakerOutput() 4 - NRG trade receivesUnit < 0, receivesToChain: ${receivesToChain} receivesUnit: ${receivesUnit}`);
        return false;
      }

      if (!sendsUnitAsMinimumBN.mod(ratioBN).eq(new BN(0))) {
        debug(`validateMakerOutput() 5 - sendsUnitAsMinimumBN: ${sendsUnitAsMinimumBN.toString()}, ratio: ${ratioBN.toString()}`);
        return false;
      }
      if (!receivesUnitAsMinimumBN.mod(ratioBN).eq(new BN(0))) {
        debug(`validateMakerOutput() 6 - receivesUnitAsMinimumBN: ${receivesUnitAsMinimumBN.toString()}, ratio: ${ratioBN.toString()}`);
        return false;
      }
    }

    return true;
  }

  static validateTakerCallbackScript(script) {
    const parts = script.split(' ');

    if (parts.length !== 3) {
      debug('validateTakerCallbackScript() 0 - parts.length !== 3: %o', parts.length);
      return false;
    }

    const [txHash,, opCallback] = parts;

    if (!isHexString(txHash)) {
      debug('validateTakerCallbackScript() 1 - tx hash is not hex string: %o', txHash);
      return false;
    }

    if (opCallback !== 'OP_CALLBACK') {
      debug('validateTakerCallbackScript() 2 - op is not OP_CALLBACK: %o', opCallback);
      return false;
    }

    return true;
  }

  static validateTakerOutputScript(script) {
    const {
      makerTxHash,
      makerTxOutputIndex,
      doubleHashedBcAddress
    } = parseTakerLockScript(script);
    const reConstructedOutputScript = createTakerLockScript(makerTxHash, makerTxOutputIndex, doubleHashedBcAddress, true);

    if (reConstructedOutputScript !== script) {
      debug(`validateTakerOutputScript() 1 - reConstructedOutputScript !== script: ${reConstructedOutputScript},\n${script}`);
      return false;
    }
    return true;
  }

  // TODO: move NRG transfer output script login from engine.index to here

  static createNRGOutputLockScript(bcAddress) {
    return createNRGLockScript(bcAddress);
  }

  static createTakerCallbackScript(makerTxHash, makerTxOutputIndex) {
    return createTakerCallbackLockScript(makerTxHash, makerTxOutputIndex);
  }

  static createTakerOutputScript(makerTxHash, makerTxOutputIndex, bcAddress) {
    return createTakerLockScript(makerTxHash, makerTxOutputIndex, bcAddress);
  }

  static createTakerInputScript(sendsFromAddress, receivesToAddress) {
    return createTakerUnlockScript(sendsFromAddress, receivesToAddress);
  }

  static createMakerOutputScript(shiftMaker, shiftTaker, depositLength, settleLength, sendsFromChain, receivesToChain, sendsFromAddress, receivesToAddress, sendsUnit, receivesUnit, fixedUnitFee, bcAddress) {
    return createMakerLockScript(shiftMaker, shiftTaker, depositLength, settleLength, sendsFromChain, receivesToChain, sendsFromAddress, receivesToAddress, sendsUnit, receivesUnit, fixedUnitFee, bcAddress);
  }

  /*
   * !!! NRG ORDER TYPE !!!
   * Creates an output script for use with NRG pairs
   * See createMakerOutputScript above for regular orders
   */
  static createMakerNrgOutputScript(shiftMaker, shiftTaker, depositLength, settleLength, sendsFromChain, receivesToChain, sendsFromAddress, receivesToAddress, sendsUnit, receivesUnit, fixedUnitFee, bcAddress) {
    return createMakerLockScript(shiftMaker, shiftTaker, depositLength, settleLength, sendsFromChain, receivesToChain, sendsFromAddress, receivesToAddress, sendsUnit, receivesUnit, fixedUnitFee, bcAddress);
  }
}

exports.ScriptTemplates = ScriptTemplates;
const parseNRGLockcript = exports.parseNRGLockcript = script => {
  return sdkParseNRGLockScript(new Uint8Array(fromASM(script, 0x01)));
};

const parseTakerLockScript = exports.parseTakerLockScript = script => {
  // TODO this function should receive Uint8Array, not string
  return sdkParseTakerLockScript(new Uint8Array(fromASM(script, 0x01)));
};

const parseTakerUnlockScript = exports.parseTakerUnlockScript = script => {
  // TODO this function should receive Uint8Array, not string
  return sdkParseTakerUnlockScript(new Uint8Array(fromASM(script, 0x01)));
};

const parseMakerLockScript = exports.parseMakerLockScript = script => {
  // TODO this function should receive Uint8Array, not string
  return sdkParseMakerLockScript(new Uint8Array(fromASM(script, 0x01)));
};

// takes proto Transaction and returns blake2bl doubled string
const txHash = exports.txHash = tx => {
  const obj = tx.toObject();
  const inputs = obj.inputsList.map(input => {
    return [input.outPoint.value, input.outPoint.hash, input.outPoint.index, input.scriptLength, input.inputScript].join('');
  }).join('');

  const outputs = obj.outputsList.map(output => {
    return [output.value, output.unit, output.scriptLength, output.outputScript].join('');
  }).join('');

  const parts = [obj.version, obj.nonce, obj.overline, obj.ninCount, obj.noutCount, obj.lockTime, inputs, outputs];

  const prehash = blake2bl(parts.join(''));
  const hash = blake2bl(prehash);
  return hash;
};

// FIXME <- no fix needed, needs to sign all outputs and the outpoint must include the tx hash + the index
// takes proto of OutPoint and list of proto TransactionOutput returns buffer hash
const outPointOutputHash = exports.outPointOutputHash = (outpoint, outputs) => {
  const outputsData = outputs.map(output => {
    var obj = output.toObject();
    return [obj.value, obj.unit, obj.scriptLength, obj.outputScript].join('');
  }).join('');

  const parts = [internalToHuman(outpoint.getValue(), NRG), outpoint.getHash(), outpoint.getIndex(), outputsData];

  const hash = blake2bl(parts.join(''));
  return hash;
};

// sign data ANY with private key Buffer
// return 65B long signature with recovery number as the last byte
const signData = exports.signData = (data, privateKey) => {
  data = toBuffer(data);
  const dataHash = blake2bl(data);
  const sig = secp256k1.sign(Buffer.from(dataHash, 'hex'), privateKey);

  if (sig.signature.length !== 64) {
    throw Error(`Signature should always be 64B long, l: ${sig.signature.length}`);
  }
  const signatureWithRecovery = Buffer.concat([sig.signature, intToBuffer(sig.recovery)]);

  return signatureWithRecovery;
};

/**
 * Accepts signedData by rawSignature and recovers a publicKey from these
 *
 * @param {string} signedData data which where signed by rawSignature, usually hash of TX
 * @param {Buffer} rawSignature in 66B format (recovery number added to the end of signature)
 * @returns {Buffer} 64B public key
 */
const pubKeyRecover = exports.pubKeyRecover = (signedData, rawSignature) => {
  const pubKey = secp256k1.recover(Buffer.from(signedData, 'hex'), rawSignature.slice(0, 64), bufferToInt(rawSignature.slice(64)));
  return secp256k1.publicKeyConvert(pubKey, false).slice(1);
};

// create input signature of current tx referencing outpoint
const txInputSignature = exports.txInputSignature = (outpoint, tx, privateKey) => {
  const dataToSign = generateDataToSignForSig(outpoint, tx);
  const sig = signData(dataToSign, privateKey);

  return sig;
};

const generateDataToSignForSig = exports.generateDataToSignForSig = (outPoint, tx) => {
  return outPointOutputHash(outPoint, tx.getOutputsList());
};

/**
 * Creates pair of transactions and private key transactions which original from a coinbase
 * @returns [Buffer] private keys and transactions protobuf
 */
const newBlankTxs = exports.newBlankTxs = (n = 2) => {
  const list = [];
  for (var i = 0; i < n; i++) {
    list.push(new Transaction());
  }
  return list;
};

const getTxDistance = exports.getTxDistance = tx => {
  let nonce = TX_DEFAULT_NONCE;
  if (tx.getNonce() !== undefined && tx.getNonce() !== '' && tx.getNonce() !== '0') {
    nonce = tx.getNonce();
  }
  // note the outpoint of the first input is used in the tx
  const inputs = tx.getInputsList();
  if (inputs.length < 1) {
    // coinbase transactions cannot have distance
    return new BN(0);
  }
  if (inputs[0].getOutPoint() === undefined || inputs[0].getOutPoint() === '' || inputs[0].getOutPoint() === '0') {
    // coinbase transactions cannot have distance
    return new BN(0);
  }
  const outPoint = tx.getInputsList()[0].getOutPoint();
  const checksum = tx.getHash() + outPoint.getHash() + outPoint.getIndex();
  return new BN(overlineDistance(blake2bl(nonce), blake2bl(checksum)));
};

// gets the distances summed for the given Transactions
const getTxsDistanceSum = exports.getTxsDistanceSum = txs => {
  const txDistanceSum = txs.reduce((all, tx, i) => {
    if (i === 0) {
      // coinbase does not add distance
      return all;
    }
    const d = getTxDistance(tx);
    all = all.add(d);
    return all;
  }, new BN(0));

  return txDistanceSum;
};

const getTxOwnerHashed = exports.getTxOwnerHashed = tx => {
  // if there is no input, then the tx was a coinbase tx
  let owner = 'coinbase';
  for (const input of tx.getInputsList()) {
    const inputScript = toASM(Buffer.from(input.getInputScript()), 0x01);
    if (inputScript.split(' ').length === 2) {
      // give the double hashed version of the owner
      owner = inputScript.split(' ')[1];
    }
  }
  return owner;
};

/* Calculates the additional Distance available to the block based on the Emblem Balance */
const emblemToNrg = exports.emblemToNrg = emblems => {
  let amount = NRG_BLOCK_GRANT;
  if (emblems < MINIMUM_EMBLEM_TO_NRG) {
    return amount;
  } else {
    amount = NRG_BLOCK_GRANT + Math.log(emblems) * Math.log(emblems / MINIMUM_EMBLEM_TO_NRG);
    if (amount < NRG_BLOCK_GRANT) {
      amount = NRG_BLOCK_GRANT;
    }
    if (amount > 166) {
      amount = 166;
    }
    return roundToFive(amount);
  }
};

/* Calculates the additional Distance available to the block based on the Emblem Balance */
const getMaxDistanceWithEmblems = exports.getMaxDistanceWithEmblems = async (address, persistence, wirelessTxs = false) => {
  // half of the median distance of block is always carried at a cost of 166 NRG per distance unit
  // remaining half extended by emblem distance
  // the percentage consumed by the added emblem distance and other half is amount of extra nrg grant you get
  let wirelessMinerWeight = 0;
  let wirelessEmbBonus = 0;

  if (wirelessTxs && wirelessTxs.length) {
    debug(`evaluating ${wirelessTxs.length} txs for EMB balance`);
    for (let tx of wirelessTxs) {
      if (tx.getVersion() === '2' && tx.getOverline) {
        let ov = tx.getOverline();
        if (ov.length > 20) {
          ov = normalizeHexString(ov);
        }

        // prevent cb emb balance
        if (ov !== normalizeHexString(address)) {
          let bal = await persistence.getMarkedBalanceData(ov);

          if (!isNaN(bal)) {

            if (bal >= 16600) {
              // broker + hft maining full weight
              debug(`wireless tx full <- ${ov} : ${bal}`);
              wirelessMinerWeight += bal;
            } else if (bal >= MINIMUM_EMBLEM_TO_NRG) {
              // small business down weight by 50%
              debug(`wireless tx partial <- ${ov} : ${bal}`);
              bal = Math.floor(bal / 2);
              wirelessMinerWeight += bal;
            } else {
              // low balance down weight by 75%
              bal = Math.floor(bal / 4);
              debug(`wireless tx start <- ${ov} : ${bal}`);
              wirelessMinerWeight += bal;
            }
          }
        }
      }
    }

    if (wirelessMinerWeight > 0) {
      wirelessEmbBonus = Math.floor(wirelessMinerWeight / BC_WIRELESS_WEIGHT);
      debug(`EMB from wireless <- ${wirelessEmbBonus}`);
    }
  }

  const distanceAsNrg = new BN(HALF_MAX_TXDIST_BLOCK).div(new BN(166));
  let emblemBalance = await persistence.getMarkedBalanceData(address);
  emblemBalance = emblemBalance + wirelessEmbBonus;
  const emblemMultiplier = emblemToNrg(emblemBalance);
  const additionalDistance = new BN(emblemMultiplier).mul(distanceAsNrg);
  const newTotalDistance = new BN(MAX_TXDIST_BLOCK).add(additionalDistance);
  // console.log(`getMaxDistanceWithEmblems(): distanceAsNrg: ${distanceAsNrg.toNumber()}, emblem multiplier: ${emblemMultiplier}, additional distance with EMB: ${additionalDistance}`)
  // core permission
  return { totalDistance: newTotalDistance, emblemBonus: emblemMultiplier, emblemBalance: emblemBalance };
};

const getMaxBlockSize = exports.getMaxBlockSize = async (address, persistence) => {
  const emblemBalance = await persistence.getMarkedBalanceData(address);
  if (emblemBalance < MINIMUM_EMBLEM_TO_NRG) {
    // console.log(`Emblem balance ${emblemBalance} below minmum <- set max block size: ${BASE_BLOCK_SIZE}`)
    return BASE_BLOCK_SIZE;
  }
  const e = 256 * Math.log(emblemBalance) * Math.log(emblemBalance / MINIMUM_EMBLEM_TO_NRG);
  // console.log(`getMaxBlockSize() adding emblems ${e}`)
  return Math.round(BASE_BLOCK_SIZE + e);
};

/*
 * getNrgGrant returns the nrg awarded to a block
 * @param potentialEmblemNrg {number} generated from
 * @param distanceWithEmblems {BN} the theoretical new maximum with Emblems
 * @param txsConsumedDistance {BN} the a
 * @param blockHeight {BN} the current block height being mined
 * Calculates if and how much additional NRG the miners receives for the block
 */

const getNrgGrant = exports.getNrgGrant = (potentialEmblemNrg, distanceWithEmblems, txsConsumedDistance, blockHeight) => {

  if (potentialEmblemNrg <= NRG_BLOCK_GRANT) {
    return NRG_BLOCK_GRANT;
  }

  if (new BN(blockHeight).lte(new BN(3208880))) {
    return NRG_BLOCK_GRANT;
  }

  const potentialEmblemNrgBN = new BN(potentialEmblemNrg);
  let distanceWithEmblemsBN = new BN(distanceWithEmblems);
  let txsConsumedDistanceBN = new BN(txsConsumedDistance);
  let inverted = false;
  // the transaction is invalid if it exceeds the total distance
  if (distanceWithEmblemsBN.lt(txsConsumedDistanceBN)) {
    inverted = true;
    distanceWithEmblemsBN = new BN(txsConsumedDistance);
    txsConsumedDistanceBN = new BN(distanceWithEmblems);
    debugEmb(`txs consumed above distance with Emblems <- using inverse weight`);
  }

  debugEmb(`getOlGrant(): block height: ${blockHeight}, inverted: ${inverted}, potential Emblem NRG: ${potentialEmblemNrgBN.toNumber()}, distance with Emblems: ${distanceWithEmblemsBN.toNumber()}, txs consumed distance: ${txsConsumedDistance.toNumber()} `);

  if (blockHeight && new BN(blockHeight).lte(new BN(3300888))) {
    inverted = false;
  }
  // Emblem Gold distribution after BCI_BLOCK height -> all Emblem owners NRG increase until 2036
  let emblemGold = 0;
  if (new BN(blockHeight).gt(new BN(EMBLEM_GOLD_BCI_BLOCK))) {
    emblemGold = Math.round(new BN(new BN(blockHeight).sub(EMBLEM_GOLD_BCI_BLOCK)).div(new BN(EMBLEM_GOLD_WINDOW)).toNumber());
  }
  let minimumEmblemGrant = Math.round(potentialEmblemNrg / 3); // 33% with 66% empty block penalty
  let finalNrgGrant = 0;

  // begin the bandwidth calculation
  if (blockHeight && new BN(blockHeight).gte(new BN(3300888))) {
    minimumEmblemGrant = NRG_BLOCK_GRANT + Math.round(potentialEmblemNrg / 3);

    // begin the bandwidth calculation for wireless tx miner
    if (blockHeight && new BN(blockHeight).gte(new BN(4230000))) {
      txsConsumedDistanceBN = txsConsumedDistanceBN.div(new BN(3));
    }
  }

  debugEmb(`txUtls.getOlGrant(): minimum Emblem grant ${minimumEmblemGrant}`);
  if (distanceWithEmblemsBN.gt(new BN(0)) && txsConsumedDistanceBN.gt(new BN(0)) && !inverted) {
    const divisor = distanceWithEmblemsBN.div(txsConsumedDistanceBN);
    finalNrgGrant = potentialEmblemNrgBN.div(divisor).toNumber();
    debugEmb(`txUtls.getOlGrant(): divisor ${divisor.toNumber()}, final ol grant ${finalNrgGrant}`);
  }

  // cannot be below the minimum Emblem grant
  if (finalNrgGrant < minimumEmblemGrant) {
    finalNrgGrant = minimumEmblemGrant;
  }

  // cannot exceed the boost provided by Emblems
  if (new BN(finalNrgGrant).gt(potentialEmblemNrgBN)) {
    finalNrgGrant = potentialEmblemNrgBN.toNumber();
  }

  if (emblemGold > 0) {
    finalNrgGrant = finalNrgGrant + emblemGold;
  }

  if (blockHeight && new BN(blockHeight).gte(new BN(3300888))) {
    if (finalNrgGrant < NRG_BLOCK_GRANT) {
      finalNrgGrant = NRG_BLOCK_GRANT;
    }
  }

  return finalNrgGrant;
};

const getMarkedTransactionsMerkle = exports.getMarkedTransactionsMerkle = block => {
  // if there is no input, then the tx was a coinbase tx
  if (!block || !block.getMarkedTxsList) {
    return false;
  }

  const txs = block.getMarkedTxsList().sort((a, b) => {
    if (a.getIndex() > b.getIndex()) {
      return 1;
    } else if (a.getIndex() < b.getIndex()) {
      return -1;
    }
    return 0;
  });

  const hashes = txs.map(tx => {
    return tx.getId() + tx.getToken() + tx.getAddrFrom() + tx.getAddrTo() + tx.getHash() + tx.getIndex() + tx.getBlockHeight() + new BN(tx.getValue()).toString(10);
  });

  hashes.unshift(block.getHash());

  return createMerkleRoot(hashes);
};

// Miner create coinbase
const txCreateCoinbase = exports.txCreateCoinbase = async (currentBlockHeight, persistence, blockTxs, minerAddress, emblemObject) => {
  try {
    minerAddress = minerAddress.toLowerCase();
    const tx = new Transaction();
    const txsDistanceSum = getTxsDistanceSum(blockTxs);

    if (!emblemObject) {
      // this cannot factor in version 2 wireless transaction EMB bonus
      emblemObject = await getMaxDistanceWithEmblems(minerAddress, persistence);
    }

    let mintedNrg = await persistence.getNrgMintedSoFar();
    if (!mintedNrg) {
      mintedNrg = 0;
    }
    let nrgGrant = 0;
    if (mintedNrg < MAX_NRG_VALUE) {
      nrgGrant = getNrgGrant(emblemObject.emblemBonus, emblemObject.totalDistance, txsDistanceSum, currentBlockHeight);
    }
    if (mintedNrg + nrgGrant > MAX_NRG_VALUE) {
      nrgGrant = MAX_NRG_VALUE - mintedNrg;
    }
    const txFees = blockTxs.map(tx => calcTxFee(tx)).reduce((fee, sum) => sum.add(fee), new BN(0));
    // grant unit == NRG
    const grant = humanToBN(`${nrgGrant}`, NRG).add(new BN(txFees));
    const unit = new BN(1).toBuffer();
    const newOutputLockScript = ['OP_BLAKE2BLPRIV', normalizeHexString(blake2bl(blake2bl(minerAddress) + minerAddress)), 'OP_EQUALVERIFY', 'OP_CHECKSIGNOPUBKEYVERIFY'].join(' ');

    // Miner grant to miner address
    const byteCode = fromASM(newOutputLockScript, 0x01);
    const newOutput = new TransactionOutput([new Uint8Array(grant.toBuffer()), // NRG reward
    new Uint8Array(unit), byteCode.length, new Uint8Array(byteCode)]);

    // NOTE: It is important that all new outputs are added to TX before the creation of the input signature
    tx.setOutputsList([newOutput]);

    const inputs = [];

    tx.setInputsList(inputs);
    tx.setNinCount(inputs.length); // Number of Emblem transactions input
    tx.setNoutCount(1);
    tx.setNonce(minerAddress);
    tx.setOverline('0');
    tx.setLockTime(currentBlockHeight + BC_COINBASE_MATURITY);
    tx.setVersion(1);

    tx.setHash(txHash(tx));
    return tx;
  } catch (err) {
    console.trace(err);
    return false;
  }
};
// fees for transaction are not void

// key is has to be uncompressed public key
const pubKeyToAddr = exports.pubKeyToAddr = key => {
  const digest = keccak('keccak256').update(key.slice(1)).digest();

  // see https://github.com/ethereumjs/ethereumjs-util/blob/master/index.js#L317
  return digest.slice(-20);
};

const pubKeyToAddrHuman = exports.pubKeyToAddrHuman = addr => {
  // see https://github.com/ethereumjs/ethereumjs-util/blob/master/index.js#L317
  return `0x${pubKeyToAddr(addr).toString('hex')}`;
};