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
const debugUTXO = require('debug')('bcnode:tx:utxo');

const LRUCache = require('lru-cache');
const BN = require('bn.js');
const { getLogger } = require('../logger');
const { sortBlocks } = require('../utils/protoBuffers');
const { toASM } = require('bcjs/dist/script/bytecode');
const { getScriptType, ScriptType } = require('bcjs/dist/script/templates');
const { Dex } = require('./dex');
const BC_LOW_POWER_MODE = process.env.BC_LOW_POWER_MODE === 'true';

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
      let markedBlockTransactions = this.getAllMarkedTxs(block);

      for (let j = 0; j < markedBlockTransactions.length; j++) {
        let mTx = markedBlockTransactions[j];
        const { to, from, chain, amount, height, tokenType, hash, childHash } = mTx;
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
              let markedBlock = block;
              let unsettled = await this._persistence.unsettleTx(hash, chain, height, childHash, markedBlock.getHeight(), txHash, txIndex, isMaker);
              debug({ unsettled, txHash, txIndex });
              if (unsettled) {
                break;
              }
            }
          }
        }
        //unsettleEMBTransaction
        if (chain === 'eth' && tokenType === 'emb') {
          debug(`emb tx: ${amount} ${from} -> ${to} ${hash}`);
          await this._persistence.unsettleEmbTx(mTx, block);
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

      //remove uncle marked txs
      let uncleBlocks = block.getHeight() > 2925470 && block.getHeight() < 2990000 ? await this._persistence.getMarkedUncles(block) : [];
      if (uncleBlocks) {
        for (let j = 0; j < uncleBlocks.length; j++) {
          debug(`uncle block is ${uncleBlocks[j].getHash()}:${uncleBlocks[j].getHeight()}`);
          let markedList = uncleBlocks[j].getMarkedTxsList();
          for (let i = 0; i < markedList.length; i++) {
            let mtx = this.getDetailsFromMtx(markedList[i]);
            const { to, from, chain, amount, height, tokenType, hash, childHash } = mtx;
            await this._persistence.unsettleUncleTx(hash);
            let heightHash = await this._persistence.get(`${chain}.${tokenType}.${hash}.${childHash}.${height}`);
            if (heightHash && heightHash.split('.').length == 2) {
              let blockOfRemoval = await this._persistence.getBlockByHash(heightHash.split('.')[1]);
              if (blockOfRemoval) await this._persistence.unsettleEmbTx(mtx, blockOfRemoval);
            }
          }
        }
      }

      // iterate through each tx in matchedTxs Pool
      let markedBlockTransactions = this.getAllMarkedTxs(block);

      if (markedBlockTransactions.length == 0) return Promise.resolve(true);else debug(`${markedBlockTransactions.length} Marked Txs within ${block.getHeight()}:${block.getHash()}`);
      for (let j = 0; j < markedBlockTransactions.length; j++) {
        let mTx = markedBlockTransactions[j];
        debug({ mTx });
        const { to, from, chain, amount, height, tokenType, hash, childHash } = mTx;
        let trades = await this._persistence.getTradeIndices(from, to, tokenType, amount.toString());
        if (trades) {
          this.sortTrades(trades);
          for (let i = 0; i < trades.length; i++) {
            let [txHash, txIndex, _, __, type] = trades[i].split('.');
            let isMaker = type === 'maker';
            let within = await this._persistence.isTxWithinSettlement(txHash, txIndex);
            let isSettled = await this._persistence.isTxSettled(txHash, txIndex, isMaker);
            //dealing with uncles
            let isDiffHeight = false;
            let isDiffHash = false;
            let isSameTx = true;
            const markedKey = await this._persistence.get(`settle.tx.${txHash}.${txIndex}.${isMaker ? 'maker' : 'taker'}`);
            // console.log({markedKey})
            if (markedKey) {
              const [, bcHeight, childChainId, childChainHeight,, markedTxHash] = markedKey.split('.');
              if (markedTxHash != hash) isSameTx = false;
              if (height !== parseInt(childChainHeight)) isDiffHeight = true;else if (block.getHeight()) {
                let savedChildHash = await this._persistence.get(`${markedKey}.hash`);
                if (savedChildHash && savedChildHash !== childHash) isDiffHash = true;
              }
              // console.log({within,type,isSettled,isDiffHeight,height,childChainHeight:parseInt(childChainHeight),isDiffHash})
            }
            debug({ within, isSettled, isSameTx, isDiffHash, isDiffHeight });
            // console.log({within,type,isSettled,isDiffHeight,height,isSameTx})
            if (within && (!isSettled || isSameTx && isDiffHash && block.getHeight() > 2590000 || isSameTx && isDiffHeight && block.getHeight() > 2542197)) {
              let markedBlock = block;
              let settled = await this._persistence.settleTx(hash, chain, height, childHash, markedBlock.getHeight(), txHash, txIndex, isMaker);
              debug({ settled, txHash, txIndex, markedBlock });
            }
          }
        }
        if (chain === 'eth' && tokenType === 'emb') {
          debug(`emb tx: ${amount} ${from} -> ${to} ${hash}`);
          await this._persistence.settleEmbTx(mTx, block);
        }
      }

      return Promise.resolve(true);
    } catch (err) {
      this._logger.info(`err - ${err}`);
      return Promise.resolve(true);
    }
  }

  async onNewRoveredBlock(possibleTransactions, blockHash) {

    if (BC_LOW_POWER_MODE) {
      return [];
    }

    if (possibleTransactions.length > 0) {
      const { to, from, tokenType, chain, amount, txId, height } = this.getDetailsFromPtx(possibleTransactions[0]);
      debug({ blockHash, checking: possibleTransactions.length, chain, height });
    } else {
      debug({ blockHash, checking: possibleTransactions.length });
    }

    let markedTransactions = [];
    let alreadyMarked = {};
    let uniqueTxs = {};
    try {
      for (let j = 0; j < possibleTransactions.length; j++) {
        let pTx = possibleTransactions[j];
        const { to, from, tokenType, chain, amount, txId, height } = this.getDetailsFromPtx(pTx);

        if (tokenType !== 'btc') debugUTXO(`Index (${j}): ${amount.toString()} ${tokenType} from ${from} to ${to} within ${height}:${blockHash}`);
        let trades = await this._persistence.getTradeIndices(from, to, tokenType, amount.toString());
        if (trades) {
          this.sortTrades(trades);
          for (let i = 0; i < trades.length; i++) {
            let [txHash, txIndex, _, __, type] = trades[i].split('.');
            let within = await this._persistence.isTxWithinSettlement(txHash, txIndex);
            let settledWithinThisBlock = await this._persistence.get(`${chain}.${height}.${txId}`);
            debug({ within, type, settledWithinThisBlock });
            if (settledWithinThisBlock || within && !uniqueTxs[`${txId}`] && !alreadyMarked[`${txHash}.${txIndex}.${type}`]) {
              alreadyMarked[`${txHash}.${txIndex}.${type}`] = true;
              uniqueTxs[`${txId}`] = true;
              markedTransactions.push(this.createMarkedTx(pTx));
              break;
            }
          }
        }
      }
    } catch (err) {
      this._logger.info(err);
    }

    debug({ markedTransactions, blockHash });

    // if the block has already been processed but is sent again by Rover
    if (blockHash && this._markedTxsCache.has(blockHash)) {
      let marked = this._markedTxsCache.get(blockHash);
      //if(markedTransactions.length <= marked.length){
      //  return marked
      //}
      if (marked && markedTransactions.length !== marked.length) {
        this._logger.info(`cached block marked txs length does not match local <- cached: ${marked.length} local: ${markedTransactions.length}`);
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
    const txId = pTx.getTxId();
    const height = pTx.getBlockHeight();
    return { to, from, tokenType, chain, amount, txId, height };
  }

  getAllMarkedTxs(blockUp) {
    const headersMap = blockUp.getBlockchainHeaders();
    let markedTxs = [];
    let methodNames = Object.keys(headersMap.toObject());
    let _this = this;
    for (let i = 0; i < methodNames.length; i++) {
      let rover = methodNames[i];
      const getMethodName = `get${rover[0].toUpperCase()}${rover.slice(1)}`;
      const childBlocks = headersMap[getMethodName]();
      for (let j = 0; j < childBlocks.length; j++) {
        let cb = childBlocks[j];
        if (cb) {
          let marked = cb.getMarkedTxsList().map(mTx => {
            let obj = _this.getDetailsFromMtx(mTx);
            obj.childHash = cb.getHash();
            return obj;
          });
          markedTxs = concat(markedTxs, marked);
        }
      }
    }
    return markedTxs;
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