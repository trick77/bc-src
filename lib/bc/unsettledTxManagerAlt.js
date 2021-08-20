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
const { MarkedTxsReq } = require('../protos/rover_pb');
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
const BC_ADD_REMOVE_BLOCK_LOG = process.env.BC_ADD_REMOVE_BLOCK_LOG === 'true';

let ADD = false;
let REMOVE = false;

if (BC_ADD_REMOVE_BLOCK_LOG) {
  ADD = require('fs').createWriteStream('add_block_log.csv', 'utf-8');
  REMOVE = require('fs').createWriteStream('remove_block_log.csv', 'utf-8');
  ADD.write('timestamp,height,hash\n');
  REMOVE.write('timestamp,height,hash\n');
}

const getDetailsFromMtx = mTx => {
  const to = mTx.getAddrTo();
  const from = mTx.getAddrFrom();
  const chain = mTx.getId();
  const amount = new BN(mTx.getValue());
  const height = mTx.getBlockHeight();
  const hash = mTx.getHash();
  const tokenType = mTx.getToken();
  return { to, from, chain, amount, height, hash, tokenType };
};

const getAllMarkedTxs = blockUp => {
  const headersMap = blockUp.getBlockchainHeaders();
  let markedTxs = [];
  let methodNames = Object.keys(headersMap.toObject());
  for (let i = 0; i < methodNames.length; i++) {
    let rover = methodNames[i];
    const getMethodName = `get${rover[0].toUpperCase()}${rover.slice(1)}`;
    const childBlocks = headersMap[getMethodName]();
    for (let j = 0; j < childBlocks.length; j++) {
      let cb = childBlocks[j];
      if (cb) {
        let marked = cb.getMarkedTxsList().map(mTx => {
          let obj = getDetailsFromMtx(mTx);
          obj.childHash = cb.getHash();
          return obj;
        });
        markedTxs = concat(markedTxs, marked);
      }
    }
  }
  return markedTxs;
};

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

      debug(`removing ${block.getHeight()} : ${block.getHash().slice(0, 6)}`);
      if (BC_ADD_REMOVE_BLOCK_LOG && block && !block.getBlockchain) {
        REMOVE.write(`${Math.floor(Date.now() / 1000)},${block.getHeight()},${block.getHash().slice(0, 6)}\n`);
      }

      let markedBlockTransactions = getAllMarkedTxs(block);

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
      this._logger.info(`removeBcBlock err - ${err}`);
      return Promise.resolve(true);
    }
  }

  async onNewBcBlock(block) {
    try {

      debug(`adding ${block.getHeight()} : ${block.getHash().slice(0, 6)}`);
      if (BC_ADD_REMOVE_BLOCK_LOG && block && !block.getBlockchain) {
        ADD.write(`${Math.floor(Date.now() / 1000)},${block.getHeight()},${block.getHash().slice(0, 6)}\n`);
      }
      //remove uncle marked txs
      let uncleBlocks = block.getHeight() > 2925470 && block.getHeight() < 2990000 ? await this._persistence.getMarkedUncles(block) : [];
      if (uncleBlocks) {
        for (let j = 0; j < uncleBlocks.length; j++) {
          debug(`uncle block is ${uncleBlocks[j].getHash()}:${uncleBlocks[j].getHeight()}`);
          let markedList = uncleBlocks[j].getMarkedTxsList();
          for (let i = 0; i < markedList.length; i++) {
            let mtx = getDetailsFromMtx(markedList[i]);
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
      let markedBlockTransactions = getAllMarkedTxs(block);

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
      this._logger.info(`onNewBcBlock err - ${err}`);
      return Promise.resolve(true);
    }
  }

  async getQueuedMarkedTxs(markedTransactions, blockHash, blockchain) {
    let date = Date.now();
    debug(`queued mtx ${blockchain}:${blockHash} (${markedTransactions.length})`);
    if (BC_LOW_POWER_MODE) {
      return [];
    }

    if (markedTransactions.length === 0) {
      return [];
    }

    if (!blockHash) {
      this._logger.error(`getQueuedMarkedTxs - block hash parameter required`);
      return [];
    }

    if (!blockchain) {
      this._logger.error(`getQueuedMarkedTxs - blockchain parameter required`);
      return [];
    }

    const block = await this._persistence.getBlockByHash(blockHash, blockchain);

    if (!block || !block.getBlockchainHeaders) {
      await this._persistence.delBlock(blockHash, '0', blockchain);
      return [];
    }

    const blockHeight = block.getHeight();

    const localMarkedTxs = getAllMarkedTxs(block);

    const queuedMarkedTxs = markedTransactions.reduce((queued, mtx) => {

      const remaining = [];
      let found = false;
      for (const lm of localMarkedTxs) {
        if (mtx.getHash() === lm.getHash()) {
          if (mtx.getId() === lm.getId()) {
            if (mtx.getValue() === lm.getValue()) {
              if (mtx.getToken() === lm.getToken()) {
                if (mtx.getBlockHeight() === lm.getBlockHeight()) {
                  found = true;
                }
              }
            }
          }
        }
      }

      if (!found) {
        // this transaction is considered queued for the next block
        mtx.setBlockHash(blockHash);
        all.push(mtx);
      }

      return all;
    }, []);

    if (queuedMarkedTxs && queuedMarkedTxs.length > 0) {

      const currentQueue = await this._persistence.get(`${blockchain}.markedtx.queue`);

      if (!currentQueue) {
        const req = new MarkedTxsReq();
        req.setBlockchain(blockchain);
        req.setBlockHash(blockHash);
        req.setMarkedTransactionsList(queuedMarkedTxs);
        await this._persistence.put(`${blockchain}.markedtx.queue`, req);
      } else {

        const currentMtx = currentQueue.getMarkedTransactionsList();

        for (const q of queuedMarkedTxs) {
          let found = false;
          for (const c of currentMtx) {
            if (q.getHash() === c.getHash()) {
              if (q.getId() === c.getId()) {
                if (q.getToken() === c.getToken()) {
                  if (q.getBlockHeight() === c.getBlockHeight()) {
                    found = true;
                  }
                }
              }
            }
          }

          if (!found) {
            currentMtx.push(q);
          }
        }
        currentQueue.setMarkedTransactionsList(currentMtx);
        await this._persistence.put(`${blockchain}.markedtx.queue`, currentQueue);

        return currentMtx.filter(c => {
          if (new BN(c.getBlockHeight()).gte(new BN(blockHeight))) {
            return c;
          }
        });
      }
    } else {

      const req = new MarkedTxsReq();
      req.setBlockchain(blockchain);
      req.setBlockHash(blockchain);
    }

    return queuedMarkedTxs;
  }

  async onNewRoveredBlock(possibleTransactions, blockHash, blockchain) {

    let date = Date.now();
    if (BC_LOW_POWER_MODE) {
      return [];
    }

    let queuedMarkedTxs = [];
    if (blockchain) {
      const queue = await this._persistence.get(`${blockchain}.markedtx.queue`);
      const markedTxs = queue.getMarkedTransactionsList();
      let found = false;
      for (let m of markedTxs) {
        found = false;
        for (let b of possibleTransactions) {
          if (b.getBlockHeight() > m.getBlockHeight()) {
            found = true;
          }
        }
        if (!found) {
          this._logger.info(`adding ${blockchain} queued tx: ${m.getHash()}`);
          possibleTransactions.push(m);
        }
      }

      if (found) {
        this._logger.info(`clearing ${blockchain} marked queue`);
        await this._persistence.del(`${blockchain}.markedtx.queue`);
      }
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

        if (tokenType !== 'btc') debugUTXO(`Index (${j}): ${amount.toString()} ${tokenType} from ${from} to ${to} within ${height}:${blockHash} has hash ${txId}`);
        let trades = await this._persistence.getTradeIndices(from, to, tokenType, amount.toString());
        if (trades) {
          this.sortTrades(trades);
          for (let i = 0; i < trades.length; i++) {
            let [txHash, txIndex, _, __, type] = trades[i].split('.');
            let within = await this._persistence.isTxWithinSettlement(txHash, txIndex);
            // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
            // add support here for variable block references
            //
            let settledWithinThisBlock = await this._persistence.get(`${chain}.${height}.${txId}`);
            debug({ within, type, settledWithinThisBlock, txHash, txIndex });
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

    debug(`${blockHash} took ${Date.now() - date}ms to eval ${markedTransactions.length} txs`);

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
            let obj = getDetailsFromMtx(mTx);
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