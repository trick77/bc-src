'use strict';

var _decimal = require('decimal.js');

const PersistenceRocksDb = require('../persistence').RocksDb; /*
                                                               * Copyright (c) 2017-present, Block Collider developers, All rights reserved.
                                                               *
                                                               * This source code is licensed under the MIT license found in the
                                                               * LICENSE file in the root directory of this source tree.
                                                               *
                                                               * 
                                                               */

const {
  MarkedTransaction,
  BcBlock,
  Transaction,
  TransactionOutput
} = require('../protos/core_pb');
const {
  internalToHuman,
  internalToBN,
  COIN_FRACS: { NRG, BOSON }
} = require('../core/coin');
const { concat } = require('ramda');
const debug = require('debug')('bcnode:tx:unsettledTxManagerAlt');
const LRUCache = require('lru-cache');
const BN = require('bn.js');
const { getLogger } = require('../logger');
const { sortBlocks } = require('../utils/protoBuffers');
const { toASM } = require('bcjs/dist/script/bytecode');
const { getScriptType, ScriptType } = require('bcjs/dist/script/templates');
const { Dex } = require('./dex');

const {
  parseTakerUnlockScript,
  parseMakerLockScript,
  parseTakerLockScript
} = require('../core/txUtils');

class UnsettledTxManager {

  constructor(persistence, minerKey) {
    this._persistence = persistence;
    this._logger = getLogger(__dirname);
    this._dex = new Dex(this._persistence, minerKey);
    this._markedTxsCache = new LRUCache({
      max: 2000
    });
  }

  // always sort the utxos by trade height of maker and then by collateral
  async getMatchedOrders() {
    let txs = await this._dex.getAllMatchedOrders();
    // console.log({txs})
    txs.sort((a, b) => {
      if (a.getMaker().getTradeHeight() < b.getMaker().getTradeHeight()) return -1;else if (a.getMaker().getTradeHeight() > b.getMaker().getTradeHeight()) return 1;else {
        debug({ a: a.getTaker().getTxHash(), b: b.getTaker().getTxHash() });
        debug([a.getTaker().getTotalCollateral(), b.getTaker().getTotalCollateral()]);
        debug(new _decimal.Decimal(a.getTaker().getTotalCollateral()).gte(new _decimal.Decimal(b.getTaker().getTotalCollateral())));
        return new _decimal.Decimal(a.getTaker().getTotalCollateral()).gte(new _decimal.Decimal(b.getTaker().getTotalCollateral())) ? -1 : 1;
      }
    });
    return txs;
  }

  async removeBcBlock(block) {
    try {
      // iterate through each tx in matchedTxs Pool
      let markedBlockTransactions = await this.getAllMarkedTxs(block);

      let txMap = {};
      for (let j = 0; j < markedBlockTransactions.length; j++) {
        let mTx = markedBlockTransactions[j];
        const { to, from, chain, amount, height, tokenType, hash } = this.getDetailsFromMtx(mTx);
        txMap[`${to}.${from}.${tokenType}.${amount.toString()}`] = { chain, height, hash };
      }

      let txs = await this.getMatchedOrders();

      for (let i = 0; i < txs.length; i++) {
        let tx = txs[i];
        let maker = tx.getMaker();
        let taker = tx.getTaker();

        let sendsUnit = new _decimal.Decimal(maker.getSendsUnit()).mul(new _decimal.Decimal(maker.getCollateralizedNrg()).div(new _decimal.Decimal(maker.getOriginalNrg()))).toNumber();

        let receivesUnit = new _decimal.Decimal(maker.getReceivesUnit()).mul(new _decimal.Decimal(maker.getCollateralizedNrg()).div(new _decimal.Decimal(maker.getOriginalNrg()))).toNumber();

        //maker
        if (txMap[checkMaker]) {
          await this._persistence.unsettleTx(txMap[checkMaker].hash, txMap[checkMaker].chain, txMap[checkMaker].height, this.getBlockForMarkedTx(block, txMap[checkMaker].hash), taker.getTxHash(), taker.getTxOutputIndex(), true);
        }

        //taker
        if (txMap[checkTaker]) {
          await this._persistence.unsettleTx(txMap[checkTaker].hash, txMap[checkTaker].chain, txMap[checkTaker].height, this.getBlockForMarkedTx(block, txMap[checkTaker].hash), taker.getTxHash(), taker.getTxOutputIndex(), false);
        }
      }
      return Promise.resolve(true);
    } catch (err) {
      this._logger.info(`err - ${err}`);
      return Promise.resolve(true);
    }
  }

  async onNewBcBlock(block) {
    try {
      // iterate through each tx in matchedTxs Pool
      let markedBlockTransactions = await this.getAllMarkedTxs(block);

      // console.log({markedBlockTransactions})
      if (markedBlockTransactions.length == 0) return Promise.resolve(true);

      let txMap = {};
      for (let j = 0; j < markedBlockTransactions.length; j++) {
        let mTx = markedBlockTransactions[j];
        const { to, from, chain, amount, height, tokenType, hash } = this.getDetailsFromMtx(mTx);
        txMap[`${to}.${from}.${tokenType}.${amount.toString()}`] = { chain, height, hash };
      }

      let txs = await this.getMatchedOrders();

      for (let i = 0; i < txs.length; i++) {
        let tx = txs[i];
        let maker = tx.getMaker();
        let taker = tx.getTaker();

        let sendsUnit = new _decimal.Decimal(maker.getSendsUnit()).mul(new _decimal.Decimal(maker.getCollateralizedNrg()).div(new _decimal.Decimal(maker.getOriginalNrg()))).toNumber();

        let receivesUnit = new _decimal.Decimal(maker.getReceivesUnit()).mul(new _decimal.Decimal(maker.getCollateralizedNrg()).div(new _decimal.Decimal(maker.getOriginalNrg()))).toNumber();

        let checkMaker = `${taker.getReceivesToAddress()}.${maker.getSendsFromAddress()}.${maker.getSendsFromChain()}.${sendsUnit}`;
        let checkTaker = `${maker.getReceivesToAddress()}.${taker.getSendsFromAddress()}.${maker.getReceivesToChain()}.${receivesUnit}`;

        //maker
        if (txMap[checkMaker]) {
          let within = await this._persistence.isTxWithinSettlement(taker.getTxHash(), taker.getTxOutputIndex(), true);
          if (within) {
            let settled = await this._persistence.settleTx(txMap[checkMaker].hash, txMap[checkMaker].chain, txMap[checkMaker].height, this.getBlockForMarkedTx(block, txMap[checkMaker].hash), taker.getTxHash(), taker.getTxOutputIndex(), true);
            debug({ settled, txHash: taker.getTxHash() });
          }
        }

        //taker
        if (txMap[checkTaker]) {
          let within = await this._persistence.isTxWithinSettlement(taker.getTxHash(), taker.getTxOutputIndex(), false);
          if (within) {
            let settled = await this._persistence.settleTx(txMap[checkTaker].hash, txMap[checkTaker].chain, txMap[checkTaker].height, this.getBlockForMarkedTx(block, txMap[checkTaker].hash), taker.getTxHash(), taker.getTxOutputIndex(), false);
            debug({ settled, txHash: taker.getTxHash() });
          }
        }
      }

      return Promise.resolve(true);
    } catch (err) {
      this._logger.info(`err - ${err}`);
      return Promise.resolve(true);
    }
  }

  async onNewRoveredBlock(possibleTransactions, blockHash) {

    // if the block has already been processed but is sent again by Rover
    if (blockHash && this._markedTxsCache.has(blockHash)) {
      return this._markedTxsCache.get(blockHash);
    }

    let txMap = {};
    for (let j = 0; j < possibleTransactions.length; j++) {
      let pTx = possibleTransactions[j];
      const { to, from, tokenType, chain, amount } = this.getDetailsFromPtx(pTx);
      txMap[`${to}.${from}.${tokenType}.${amount.toString()}`] = pTx;
    }

    const markedTransactions = [];
    let txs = await this.getMatchedOrders();
    try {
      for (let i = 0; i < txs.length; i++) {

        let tx = txs[i];
        let maker = tx.getMaker();
        let taker = tx.getTaker();

        let sendsUnit = new _decimal.Decimal(maker.getSendsUnit()).mul(new _decimal.Decimal(maker.getCollateralizedNrg()).div(new _decimal.Decimal(maker.getOriginalNrg()))).toNumber();

        let receivesUnit = new _decimal.Decimal(maker.getReceivesUnit()).mul(new _decimal.Decimal(maker.getCollateralizedNrg()).div(new _decimal.Decimal(maker.getOriginalNrg()))).toNumber();

        // debug({sendsUnit,receivesUnit})
        // debug(`maker sends from ${maker.getSendsFromChain()} ${maker.getSendsFromAddress()} and sends to ${taker.getReceivesToAddress()} - sends : ${sendsUnit}`)
        //
        // debug(`taker sends from ${maker.getReceivesToChain()} ${taker.getSendsFromAddress()} and sends to ${maker.getReceivesToAddress()} - sends : ${receivesUnit}`)

        let checkMaker = `${taker.getReceivesToAddress()}.${maker.getSendsFromAddress()}.${maker.getSendsFromChain()}.${sendsUnit}`;
        let checkTaker = `${maker.getReceivesToAddress()}.${taker.getSendsFromAddress()}.${maker.getReceivesToChain()}.${receivesUnit}`;

        //maker
        if (txMap[checkMaker]) {
          let within = await this._persistence.isTxWithinSettlement(taker.getTxHash(), taker.getTxOutputIndex(), true);
          debug({ within, isMaker: true });
          if (within) {
            markedTransactions.push(this.createMarkedTx(txMap[checkMaker]));
          }
        }
        //taker
        if (txMap[checkTaker]) {
          let within = await this._persistence.isTxWithinSettlement(taker.getTxHash(), taker.getTxOutputIndex(), false);
          debug({ within, isTaker: true });
          if (within) {
            markedTransactions.push(this.createMarkedTx(txMap[checkTaker]));
          }
        }
      }
    } catch (err) {
      console.log({ err });
    }

    debug({ markedTransactions, blockHash });

    if (blockHash) {
      this._markedTxsCache.set(blockHash, markedTransactions);
    }
    return markedTransactions;
  }

  getDetailsFromMtx(mTx) {
    const to = mTx.getAddrTo();
    const from = mTx.getAddrFrom();
    const chain = mTx.getId();
    const amount = new BN(mTx.getValue());
    const height = mTx.getBlockHeight();
    const hash = mTx.getHash();
    const tokenType = mTx.getToken();
    return { to, from, chain, amount, height, hash, tokenType };
  }

  getDetailsFromPtx(pTx) {
    const to = pTx.getAddrTo();
    const from = pTx.getAddrFrom();
    const tokenType = pTx.getTokenType();
    const chain = pTx.getBridgedChain();
    const amount = new BN(pTx.getValue());
    return { to, from, tokenType, chain, amount };
  }

  async getAllMarkedTxs(blockUp) {
    // let block = await this._persistence.getBlockByHash(blockUp.getPreviousHash())
    const headersMap = blockUp.getBlockchainHeaders();
    let markedTxs = [];
    let methodNames = Object.keys(headersMap.toObject());

    for (let i = 0; i < methodNames.length; i++) {
      let rover = methodNames[i];
      const getMethodName = `get${rover[0].toUpperCase()}${rover.slice(1)}`;
      const childBlocks = headersMap[getMethodName]();
      let prevBlocks = [];
      for (let j = 0; j < childBlocks.length; j++) {
        let cb = childBlocks[j];
        // let pb = await this._persistence.getBlockByHash(cb.getPreviousHash(),cb.getBlockchain())
        // console.log({pb})
        if (cb) markedTxs = concat(markedTxs, cb.getMarkedTxsList());
      }
    }
    return markedTxs;
  }

  getBlockForMarkedTx(block, hash) {
    const headersMap = block.getBlockchainHeaders();
    let markedTxs = [];
    let methodNames = Object.keys(headersMap.toObject());
    for (let i = 0; i < methodNames.length; i++) {
      let rover = methodNames[i];
      const getMethodName = `get${rover[0].toUpperCase()}${rover.slice(1)}`;
      const childBlocks = headersMap[getMethodName]();
      for (let j = 0; j < childBlocks.length; j++) {
        let cb = childBlocks[j];
        markedTxs = concat(markedTxs, cb.getMarkedTxsList());
      }
    }
    for (let m of markedTxs) {
      if (m.getHash() == hash) return block.getHeight();
    }

    return block.getHeight() - 1;
  }

  createMarkedTx(pTx) {
    const mTx = new MarkedTransaction();
    mTx.setId(pTx.getBridgedChain());
    mTx.setToken(pTx.getTokenType());
    mTx.setAddrFrom(pTx.getAddrFrom());
    mTx.setAddrTo(pTx.getAddrTo());
    mTx.setValue(pTx.getValue());
    mTx.setBlockHeight(pTx.getBlockHeight());
    mTx.setHash(pTx.getTxId());
    return mTx;
  }

}

module.exports = UnsettledTxManager;