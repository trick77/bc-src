'use strict';

var _decimal = require('decimal.js');

_decimal.Decimal.set({ toExpPos: 100 }); /*
                                          * Copyright (c) 2017-present, Block Collider developers, All rights reserved.
                                          *
                                          * This source code is licensed under the MIT license found in the
                                          * LICENSE file in the root directory of this source tree.
                                          *
                                          * 
                                          */

_decimal.Decimal.set({ toExpNeg: -100 });
const PersistenceRocksDb = require('../persistence').RocksDb;
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
  sortTrades(trades) {
    trades.sort((a, b) => {
      let [_, __, ablockHeight, aCollateral, ___] = a.split('.');
      let [____, _____, bblockHeight, bCollateral, ______] = b.split('.');
      if (new _decimal.Decimal(ablockHeight).lt(new _decimal.Decimal(bblockHeight))) return -1;else if (new _decimal.Decimal(ablockHeight).gt(new _decimal.Decimal(bblockHeight))) return 1;else {
        return new _decimal.Decimal(aCollateral).gte(new _decimal.Decimal(bCollateral)) ? -1 : 1;
      }
    });
  }

  async removeBcBlock(block) {
    try {
      // iterate through each tx in matchedTxs Pool
      let markedBlockTransactions = await this.getAllMarkedTxs(block);

      for (let j = 0; j < markedBlockTransactions.length; j++) {
        let mTx = markedBlockTransactions[j];
        const { to, from, chain, amount, height, tokenType, hash } = this.getDetailsFromMtx(mTx);
        let trades = await this._persistence.getTradeIndices(from, to, tokenType, amount.toString());
        if (trades) {
          this.sortTrades(trades);
          for (let i = 0; i < trades.length; i++) {
            let [txHash, txIndex, _, __, type] = trades[i].split('.');
            let isMaker = type === 'maker';
            let within = await this._persistence.isTxWithinSettlement(txHash, txIndex);
            let isSettled = await this._persistence.isTxSettled(txHash, txIndex, isMaker);
            debug({ within, type, isSettled });
            if (within && isSettled) {
              let markedBlock = await this.getBlockForMarkedTx(block, chain, hash);
              let unsettled = await this._persistence.unsettleTx(hash, chain, height, markedBlock, txHash, txIndex, isMaker);
              debug({ unsettled, txHash, txIndex });
              if (unsettled) {
                break;
              }
            }
          }
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

      for (let j = 0; j < markedBlockTransactions.length; j++) {
        let mTx = markedBlockTransactions[j];
        const { to, from, chain, amount, height, tokenType, hash } = this.getDetailsFromMtx(mTx);
        let trades = await this._persistence.getTradeIndices(from, to, tokenType, amount.toString());
        if (trades) {
          this.sortTrades(trades);
          for (let i = 0; i < trades.length; i++) {
            let [txHash, txIndex, _, __, type] = trades[i].split('.');
            let isMaker = type === 'maker';
            let within = await this._persistence.isTxWithinSettlement(txHash, txIndex);
            let isSettled = await this._persistence.isTxSettled(txHash, txIndex, isMaker);
            debug({ within, type, isSettled });
            if (within && !isSettled) {
              let markedBlock = await this.getBlockForMarkedTx(block, chain, hash);
              let settled = await this._persistence.settleTx(hash, chain, height, markedBlock, txHash, txIndex, isMaker);
              debug({ settled, txHash, txIndex, markedBlock });
            }
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

    debug({ blockHash, checking: possibleTransactions.length });

    let markedTransactions = [];

    for (let j = 0; j < possibleTransactions.length; j++) {
      let pTx = possibleTransactions[j];
      const { to, from, tokenType, chain, amount } = this.getDetailsFromPtx(pTx);
      let trades = await this._persistence.getTradeIndices(from, to, tokenType, amount.toString());
      if (trades) {
        this.sortTrades(trades);
        for (let i = 0; i < trades.length; i++) {
          let [txHash, txIndex, _, __, type] = trades[i].split('.');
          let within = await this._persistence.isTxWithinSettlement(txHash, txIndex);
          let isSettled = await this._persistence.isTxSettled(txHash, txIndex, type === 'maker');
          debug({ within, type, isSettled });
          if (within && !isSettled) {
            markedTransactions.push(this.createMarkedTx(pTx));
            break;
          }
        }
      }
    }

    debug({ markedTransactions, blockHash });

    // if the block has already been processed but is sent again by Rover
    if (blockHash && this._markedTxsCache.has(blockHash)) {
      let marked = this._markedTxsCache.get(blockHash);
      if (markedTransactions.length <= marked.length) {
        return marked;
      }
    }

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

  getBlockForMarkedTx(block, chain, hash) {
    return block.getHeight();
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