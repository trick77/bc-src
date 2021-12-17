'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});


const BN = require('bn.js'); /*
                              * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
                              *
                              * This source code is licensed under the MIT license found in the
                              * LICENSE file in the root directory of this source tree.
                              *
                              * 
                              */

const { getLogger } = require('../logger');
const { fromASM, toASM } = require('bcjs/dist/script/bytecode');
const { createOutPoint } = require('bcjs/dist/utils/protoUtil');
const { getScriptType, ScriptType } = require('bcjs/dist/script/templates');
const { blake2bl } = require('../utils/crypto');

const {
  internalToHuman,
  CurrencyConverter,
  CurrencyInfo,
  COIN_FRACS: { NRG }
} = require('../core/coin');

const { Utxo } = require('@overline/proto/proto/core_pb');

const {
  MatchedOrderInfo,
  MakerOrderInfo,
  TakerOrderInfo
} = require('@overline/proto/proto/bc_pb');

const {
  BC_COINBASE_MATURITY,
  parseMakerLockScript,
  parseTakerLockScript,
  parseTakerUnlockScript
} = require('../core/txUtils');

const MAKER_TAKER_SETTLED = 1;
const ONLY_MAKER_SETTLED = 2;
const ONLY_TAKER_SETTLED = 3;
const NEITHER_SETTLED = 4;

class Dex {

  constructor(persistence, utxoManager) {
    this._persistence = persistence;
    this._utxoManager = utxoManager;
    this._logger = getLogger(__filename);
    this._writeEventTable = {};
    this._readEventTable = {};
  }

  async getAllMatchedOrders() {
    let { utxos } = await this._utxoManager.getUtxos(ScriptType.TAKER_OUTPUT);
    let matchedOrders = [];
    await Promise.all(utxos.map((utxo, i) => {
      return this.addTakerOrder(matchedOrders, utxo);
    }));
    return matchedOrders;
  }
  async getMatchedOrders(bcAddress, from, to) {
    if (!from) from = 0;
    if (!to) to = 1000;
    if (to < from || to - from > 1000 || to - from === 0) to = from + 1000;
    if (bcAddress) bcAddress = bcAddress.toLowerCase();
    let { utxos } = await this._utxoManager.getUtxos(ScriptType.TAKER_OUTPUT, { address: bcAddress, from, to });

    let matchedOrders = [];
    await Promise.all(utxos.map((utxo, i) => {
      return this.addTakerOrder(matchedOrders, utxo);
    }));
    return matchedOrders;
  }

  async getOpenOrder(hash, index) {
    let utxoIndex = await this._persistence.get(`opunspent.${hash}.${index}`);
    if (utxoIndex >= 0) {
      let openOrders = [];
      let utxo = await this._persistence.get(`utxo.${ScriptType.MAKER_OUTPUT}.${utxoIndex}`);
      if (utxo) this.addMakerOrder(openOrders, utxo);
      return openOrders;
    } else return [];
  }
  async getMatchedOrder(hash, index) {
    let utxoIndex = await this._persistence.get(`opunspent.${hash}.${index}`);
    if (utxoIndex >= 0) {
      let matchedOrders = [];
      let utxo = await this._persistence.get(`utxo.${ScriptType.TAKER_OUTPUT}.${utxoIndex}`);
      if (utxo) await this.addTakerOrder(matchedOrders, utxo);
      return matchedOrders;
    } else return [];
  }
  async getOpenCallbackOrder(hash, index) {
    let utxoIndex = await this._persistence.get(`opunspent.${hash}.${index}`);
    if (utxoIndex >= 0) {
      let openOrders = [];
      let utxo = await this._persistence.get(`utxo.${ScriptType.TAKER_CALLBACK}.${utxoIndex}`);
      if (utxo) await this.addMakerCallbackOrder(openOrders, utxo);
      return openOrders;
    } else return [];
  }

  async getOpenOrders(bcAddress, from, to) {
    if (!from) from = 0;
    if (!to) to = 1000;
    if (to < from || to - from > 1000 || to - from === 0) to = from + 1000;
    if (bcAddress) bcAddress = bcAddress.toLowerCase();
    let openOrders = [];
    let { utxos } = await this._utxoManager.getUtxos(ScriptType.MAKER_OUTPUT, { address: bcAddress, from, to });
    let { utxos: callbackUtxos } = await this._utxoManager.getUtxos(ScriptType.TAKER_CALLBACK, { address: bcAddress, from, to });

    for (let i = 0; i < utxos.length; i++) {
      this.addMakerOrder(openOrders, utxos[i]);
    }

    for (let i = 0; i < callbackUtxos.length; i++) {
      await this.addMakerCallbackOrder(openOrders, callbackUtxos[i]);
    }
    return openOrders;
  }

  addMakerOrder(openOrders, utxo) {
    // FIXME return instead of pass & push
    let { output, op } = this.getOutput(utxo);
    // const { deposit } = parseMakerLockScript(
    //   toASM(Buffer.from(output.getOutputScript()), 0x01)
    // )
    // if (latestBlock.getHeight() < utxo.getBlockHeight() + deposit) {
    openOrders.push(this.extractMakerOrder(op, output, utxo.getBlockHeight(), output.getOutputScript()));
    // }
    return;
  }

  async addMakerCallbackOrder(openOrders, utxo) {
    // FIXME return instead of pass & push
    let { output, op, outputScript } = this.getOutput(utxo);
    let [originalScript, blockHeight, makerOutput] = await this._utxoManager.getInitialMakerOrder(outputScript);
    const { deposit } = parseMakerLockScript(originalScript);
    // if (latestBlock.getHeight() < blockHeight + deposit) {
    openOrders.push(this.extractMakerOrder(op, makerOutput, blockHeight, new Uint8Array(fromASM(originalScript, 0x01))));
    // }
    return;
  }

  async addTakerOrder(matchedOrders, utxo) {
    // FIXME return instead of pass & push
    let { output, op, outputScript } = this.getOutput(utxo);

    // build maker order
    const [parentTxHash, parentOutputIndex] = outputScript.split(' ');
    let [originalScript, blockHeight, makerOutput] = await this._utxoManager.getInitialMakerOrder(outputScript);
    let base = new BN(parseMakerLockScript(originalScript).base);
    const op2 = createOutPoint(parentTxHash, parentOutputIndex, new BN(output.getValue()).div(base));
    let maker = this.extractMakerOrder(op2, makerOutput, blockHeight, new Uint8Array(fromASM(originalScript, 0x01)));

    // build taker
    let tx = await this._persistence.getTransactionByHash(utxo.getTxHash());
    let taker = null;
    if (tx) {
      for (let input of tx.getInputsList()) {
        const outPoint = input.getOutPoint();
        if (outPoint.getHash() === parentTxHash && outPoint.getIndex().toString() === parentOutputIndex) {
          taker = this.extractTakerOrder(input.getInputScript(), output.getOutputScript(), op, utxo.getBlockHeight());
          break;
        }
      }
    } else {
      this._logger.info(`${utxo.getTxHash()} not found`);
      return;
    }

    let status = await this.tradeStatus(op.getHash(), op.getIndex());
    maker.setIsSettled(status === ONLY_MAKER_SETTLED || status === MAKER_TAKER_SETTLED);
    taker.setIsSettled(status === ONLY_TAKER_SETTLED || status === MAKER_TAKER_SETTLED);

    let matchedOrder = new MatchedOrderInfo();
    matchedOrder.setMaker(maker);
    matchedOrder.setTaker(taker);

    matchedOrders.push(matchedOrder);
    return;
  }

  extractMakerOrder(outpoint, originalOutput, blockHeight, script) {
    let order = new MakerOrderInfo();
    const makerInfo = parseMakerLockScript(toASM(Buffer.from(script), 0x01));

    Object.keys(makerInfo).map(key => {
      order[`set${key[0].toUpperCase()}${key.slice(1)}`](makerInfo[key]);
    });

    order.setFixedUnitFee(CurrencyConverter.nrg(order.getFixedUnitFee(), 'boson', 'nrg'));
    order.setTradeHeight(blockHeight);
    order.setSendsUnit(makerInfo.sendsUnit);
    order.setReceivesUnit(makerInfo.receivesUnit);
    order.setCollateralizedNrg(internalToHuman(outpoint.getValue(), NRG).toString());
    order.setOriginalNrg(internalToHuman(originalOutput.getValue(), NRG).toString());
    order.setNrgUnit(internalToHuman(originalOutput.getUnit(), NRG).toString());
    order.setTxHash(outpoint.getHash());
    order.setTxOutputIndex(outpoint.getIndex());
    order.setIsSettled(false);

    return order;
  }

  extractTakerOrder(inputScript, outputScript, outpoint, blockHeight) {
    let order = new TakerOrderInfo();

    let { sendsFromAddress, receivesToAddress } = parseTakerUnlockScript(toASM(Buffer.from(inputScript), 0x01));
    let { doubleHashedBcAddress } = parseTakerLockScript(toASM(Buffer.from(outputScript), 0x01));

    order.setSendsFromAddress(sendsFromAddress);
    order.setReceivesToAddress(receivesToAddress);
    order.setDoubleHashedBcAddress(doubleHashedBcAddress);
    order.setTxHash(outpoint.getHash());
    order.setTxOutputIndex(outpoint.getIndex());
    order.setTotalCollateral(internalToHuman(outpoint.getValue(), NRG).toString());
    order.setTradeHeight(blockHeight);
    return order;
  }

  getOutput(utxo) {
    const output = utxo.getOutput();
    const outputScript = toASM(Buffer.from(output.getOutputScript()), 0x01);
    const op = createOutPoint(utxo.getTxHash(), utxo.getTxIndex(), new BN(output.getValue()));
    return { output, outputScript, op };
  }

  async tradeStatus(hash, index) {
    const makerSettlesInfo = await this._utxoManager.isTxSettled(hash, index, true);
    const takerSettlesInfo = await this._utxoManager.isTxSettled(hash, index, false);

    if (makerSettlesInfo === false && takerSettlesInfo === false) {
      return NEITHER_SETTLED;
    }
    if (makerSettlesInfo === true && takerSettlesInfo === true) {
      return MAKER_TAKER_SETTLED;
    }
    if (makerSettlesInfo && !takerSettlesInfo) {
      return ONLY_MAKER_SETTLED;
    }
    if (takerSettlesInfo && !makerSettlesInfo) {
      return ONLY_TAKER_SETTLED;
    }
  }

  async getHistoricalOrders(from, max) {
    if (isNaN(from)) from = 'latest';
    let latestHeight = from === 'latest' ? await this._persistence.getLastTakerBlockHeight() : from;
    if (!latestHeight) {
      // this._logger.info(`No Taker Txs`)
      return { orders: [], nextBlock: null };
    }
    if (!max) max = 1000;
    let block = await this._persistence.getBlockByHeight(latestHeight);
    let matchedOrders = [];
    let numBlocks = 0;
    let numOrders = 0;
    let nextBlock = null;
    let count = 0;
    while (block && latestHeight - block.getHeight() < 10000 && count < max) {
      for (let tx of block.getTxsList()) {
        for (let j = 0; j < tx.getOutputsList().length; j++) {
          const output = tx.getOutputsList()[j];
          const outputType = getScriptType(output.getOutputScript());
          if (outputType === ScriptType.TAKER_OUTPUT) {
            let utxo = new Utxo();
            utxo.setOutput(output);
            utxo.setTxHash(tx.getHash());
            utxo.setTxIndex(j);
            utxo.setBlockHeight(block.getHeight());
            await this.addTakerOrder(matchedOrders, utxo);
            count++;
          }
        }
      }
      nextBlock = await this._persistence.getNextTakerBlock(block.getHeight());
      if (nextBlock) block = await this._persistence.getBlockByHeight(nextBlock);else break;
    }
    return { orders: matchedOrders, nextBlock };
  }

  async getUnlockTakerTxParams(txHash, txOutputIndex) {
    const res = { scripts: [], value: null };
    if (!this._readEventTable['getUnlockTakerTxParams']) {
      this._readEventTable['getUnlockTakerTxParams'] = 0;
    }
    this._readEventTable['getUnlockTakerTxParams']++;
    const isWithinSettlement = await this._utxoManager.isTxWithinSettlement(txHash, txOutputIndex);
    const output = await this._persistence.getOutputByHashAndIndex(txHash, txOutputIndex);
    if (!output) return res;
    const takerOutputScript = toASM(Buffer.from(output.getOutputScript()), 0x01);
    const [makerScript, _, __] = await this._utxoManager.getInitialMakerOrder(takerOutputScript, 0);
    if (takerOutputScript === makerScript || getScriptType(output.getOutputScript()) === 'taker_callback') {
      res.scripts = [makerScript.split(' OP_MONAD ')[1].split(' OP_ENDMONAD')[0].trim()];
      res.value = output.getValue();
    } else if (!isWithinSettlement) {
      // we are not in settlement window and can now unlock the tx
      // check if either settled
      const didMakerSettle = await this._utxoManager.isTxSettled(txHash, txOutputIndex, true);
      const didTakerSettle = await this._utxoManager.isTxSettled(txHash, txOutputIndex, false);

      // get the spending scripts for both taker and maker
      res.value = output.getValue();

      const { base } = parseMakerLockScript(makerScript);

      const takerUnlockScript = takerOutputScript.split(' OP_MONAD ')[1].split(' OP_ENDMONAD')[0].trim();

      const makerUnlockScript = makerScript.split(' OP_MONAD ')[1].split(' OP_ENDMONAD')[0].trim();

      let scripts = [];
      if (didMakerSettle === didTakerSettle) {
        scripts = [takerUnlockScript, makerUnlockScript];
      } else if (didMakerSettle) scripts = [makerUnlockScript];else if (didTakerSettle) scripts = [takerUnlockScript];

      if (base == 1 && didMakerSettle === didTakerSettle) {
        scripts = [makerUnlockScript];
      }
      res.scripts = scripts;
    }
    return res;
  }

}
exports.Dex = Dex;