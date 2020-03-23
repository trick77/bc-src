'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/*
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const BN = require('bn.js');
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

const { Utxo } = require('../protos/core_pb');

const {
  MatchedOrderInfo,
  MakerOrderInfo,
  TakerOrderInfo
} = require('../protos/bc_pb');

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

  constructor(persistence, minerKey) {
    this._persistence = persistence;
    this._logger = getLogger(__filename);
    this._minerKey = minerKey;
  }

  async getMatchedOrders(bcAddress) {
    if (bcAddress) bcAddress = bcAddress.toLowerCase();
    let { utxos } = await this._persistence.getUtxos(ScriptType.TAKER_OUTPUT, { address: bcAddress });

    let matchedOrders = [];
    await Promise.all(utxos.map(utxo => {
      return this.addTakerOrder(matchedOrders, utxo);
    }));
    return matchedOrders;
  }

  async getOpenOrders(bcAddress) {
    if (bcAddress) bcAddress = bcAddress.toLowerCase();
    const latestBlock = await this._persistence.get(`bc.block.latest`);
    let openOrders = [];

    let { utxos } = await this._persistence.getUtxos(ScriptType.MAKER_OUTPUT, { address: bcAddress });

    for (let i = 0; i < utxos.length; i++) {
      this.addMakerOrder(latestBlock, openOrders, utxos[i]);
    }

    let { utxos: callbackUtxos } = await this._persistence.getUtxos(ScriptType.TAKER_CALLBACK, { address: bcAddress });

    await Promise.all(callbackUtxos.map(utxo => {
      return this.addMakerCallbackOrder(latestBlock, openOrders, utxo);
    }));

    return openOrders;
  }

  addMakerOrder(latestBlock, openOrders, utxo) {
    let { output, op } = this.getOutput(utxo);
    const { deposit } = parseMakerLockScript(toASM(Buffer.from(output.getOutputScript()), 0x01));
    if (latestBlock.getHeight() < utxo.getBlockHeight() + deposit) {
      openOrders.push(this.extractMakerOrder(op, output, utxo.getBlockHeight(), output.getOutputScript()));
    }
  }

  async addMakerCallbackOrder(latestBlock, openOrders, utxo) {
    let { output, op, outputScript } = this.getOutput(utxo);
    let [originalScript, blockHeight, makerOutput] = await this._persistence.getInitialMakerOrder(outputScript);
    const { deposit } = parseMakerLockScript(originalScript);
    if (latestBlock.getHeight() < blockHeight + deposit) {
      openOrders.push(this.extractMakerOrder(op, makerOutput, blockHeight, new Uint8Array(fromASM(originalScript, 0x01))));
    }
  }

  async addTakerOrder(matchedOrders, utxo) {
    let { output, op, outputScript } = this.getOutput(utxo);

    // build maker order
    const [parentTxHash, parentOutputIndex] = outputScript.split(' ');
    let [originalScript, blockHeight, makerOutput] = await this._persistence.getInitialMakerOrder(outputScript);
    let base = new BN(parseMakerLockScript(originalScript).base);
    const op2 = createOutPoint(parentTxHash, parentOutputIndex, new BN(output.getValue()).div(base));
    let maker = this.extractMakerOrder(op2, makerOutput, blockHeight, new Uint8Array(fromASM(originalScript, 0x01)));

    // build taker
    let tx = await this._persistence.getTransactionByHash(utxo.getTxHash());
    let taker = null;
    for (let input of tx.getInputsList()) {
      const outPoint = input.getOutPoint();
      if (outPoint.getHash() === parentTxHash && outPoint.getIndex().toString() === parentOutputIndex) {
        taker = this.extractTakerOrder(input.getInputScript(), output.getOutputScript(), op, utxo.getBlockHeight());
        break;
      }
    }

    let status = await this.tradeStatus(op.getHash(), op.getIndex());
    maker.setIsSettled(status === ONLY_MAKER_SETTLED || status === MAKER_TAKER_SETTLED);
    taker.setIsSettled(status === ONLY_TAKER_SETTLED || status === MAKER_TAKER_SETTLED);

    let matchedOrder = new MatchedOrderInfo();
    matchedOrder.setMaker(maker);
    matchedOrder.setTaker(taker);

    matchedOrders.push(matchedOrder);
  }

  extractMakerOrder(outpoint, originalOutput, blockHeight, script) {
    let order = new MakerOrderInfo();
    const makerInfo = parseMakerLockScript(toASM(Buffer.from(script), 0x01));

    Object.keys(makerInfo).map(key => {
      order[`set${key[0].toUpperCase()}${key.slice(1)}`](makerInfo[key]);
    });

    const ratio = new BN(originalOutput.getValue()).div(new BN(outpoint.getValue()));

    order.setFixedUnitFee(CurrencyConverter.nrg(order.getFixedUnitFee(), 'boson', 'nrg'));
    order.setTradeHeight(blockHeight);
    order.setSendsUnit(new BN(makerInfo.sendsUnit).div(ratio).toString());
    order.setReceivesUnit(new BN(makerInfo.receivesUnit).div(ratio).toString());

    order.setCollateralizedNrg(internalToHuman(outpoint.getValue(), NRG).toString());
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
    const makerSettlesInfo = await this._persistence.isTxSettled(hash, index, true);
    const takerSettlesInfo = await this._persistence.isTxSettled(hash, index, false);

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

  async getHistoricalOrders(from, max = 10000) {
    let block = await this._persistence.get(`bc.block.${from}`);
    if (!block) throw new Error('Latest block not found');
    let matchedOrders = [];
    let numBlocks = 0;
    while (matchedOrders.length < max && block && numBlocks < 100) {
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
          }
        }
      }
      block = await this._persistence.getBlockByHash(block.getPreviousHash(), 'bc', { asHeader: false, cached: true });
      numBlocks++;
    }
    return matchedOrders;
  }
}
exports.Dex = Dex;