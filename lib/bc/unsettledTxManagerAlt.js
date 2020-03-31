'use strict';

/*
 * Copyright (c) 2017-present, Block Collider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
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
  }

  // always sort the utxos by trade height of taker
  async getMatchedOrders() {
    let txs = await this._dex.getMatchedOrders();
    // console.log({txs})
    txs.sort((a, b) => {
      return a.getTaker().getTradeHeight() < b.getTaker().getTradeHeight() ? -1 : 1;
    });
    return txs;
  }

  async removeBcBlock(block) {
    try {
      // iterate through each tx in matchedTxs Pool
      let markedBlockTransactions = await this.getAllMarkedTxs(block);

      let txs = await this.getMatchedOrders();

      for (let i = 0; i < txs.length; i++) {
        let tx = txs[i];
        let maker = tx.getMaker();
        let taker = tx.getTaker();
        for (let mTx of markedBlockTransactions) {
          const { to, from, chain, amount, height, tokenType, hash } = this.getDetailsFromMtx(mTx);
          debug({ to, from, chain, amount, height, tokenType, hash });

          //maker
          if (maker.getSendsFromAddress() === from && taker.getReceivesToAddress() === to && maker.getSendsFromChain() === tokenType && new BN(maker.getSendsUnit()).eq(amount)) {
            await this._persistence.unsettleTx(hash, chain, height, this.getBlockForMarkedTx(block, mTx), taker.getTxHash(), taker.getTxOutputIndex(), true);
          }

          //taker
          if (maker.getReceivesToAddress() === from && taker.getSendsFromAddress() === to && taker.getReceivesToChain() === tokenType && new BN(maker.getReceivesUnit()).eq(amount)) {
            await this._persistence.unsettleTx(hash, chain, height, this.getBlockForMarkedTx(block, mTx), taker.getTxHash(), taker.getTxOutputIndex(), false);
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

      let txs = await this.getMatchedOrders();

      for (let i = 0; i < txs.length; i++) {
        let tx = txs[i];
        let maker = tx.getMaker();
        let taker = tx.getTaker();

        for (let mTx of markedBlockTransactions) {
          const { to, from, chain, amount, height, tokenType, hash } = this.getDetailsFromMtx(mTx);
          debug({ to, from, chain, amount, height, tokenType, hash });

          //maker
          if (maker.getSendsFromAddress() === from && taker.getReceivesToAddress() === to && maker.getSendsFromChain() === tokenType && new BN(maker.getSendsUnit()).eq(amount)) {
            if (await this._persistence.isTxWithinSettlement(taker.getTxHash(), taker.getTxOutputIndex(), true)) {
              await this._persistence.settleTx(hash, chain, height, this.getBlockForMarkedTx(block, mTx), taker.getTxHash(), taker.getTxOutputIndex(), true);
            }
          }

          //taker
          if (maker.getReceivesToAddress() === from && taker.getSendsFromAddress() === to && maker.getReceivesToChain() === tokenType && new BN(maker.getReceivesUnit()).eq(amount)) {
            if (await this._persistence.isTxWithinSettlement(taker.getTxHash(), taker.getTxOutputIndex(), false)) {
              await this._persistence.settleTx(hash, chain, height, this.getBlockForMarkedTx(block, mTx), taker.getTxHash(), taker.getTxOutputIndex(), false);
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

  async onNewRoveredBlock(possibleTransactions) {
    const markedTransactions = [];
    let txs = await this.getMatchedOrders();
    try {
      for (let j = 0; j < possibleTransactions.length; j++) {
        let pTx = possibleTransactions[j];
        const { to, from, tokenType, chain, amount } = this.getDetailsFromPtx(pTx);
        // debug(`analysing ${to} ${from} ${chain} ${tokenType}, ${amount}`)

        for (let i = 0; i < txs.length; i++) {
          let tx = txs[i];
          let maker = tx.getMaker();
          let taker = tx.getTaker();

          //maker
          if (maker.getSendsFromAddress() === from && taker.getReceivesToAddress() === to && maker.getSendsFromChain() === tokenType && new BN(maker.getSendsUnit()).eq(amount)) {
            if (await this._persistence.isTxWithinSettlement(taker.getTxHash(), taker.getTxOutputIndex(), true)) {
              markedTransactions.push(this.createMarkedTx(pTx));
              break;
            }
          }

          //taker
          if (maker.getReceivesToAddress() === from && taker.getSendsFromAddress() === to && maker.getReceivesToChain() === tokenType && new BN(maker.getReceivesUnit()).eq(amount)) {
            if (await this._persistence.isTxWithinSettlement(taker.getTxHash(), taker.getTxOutputIndex(), false)) {
              markedTransactions.push(this.createMarkedTx(pTx));
              break;
            }
          }
        }
      }
    } catch (err) {
      console.log({ err });
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
    let block = await this._persistence.getBlockByHash(blockUp.getPreviousHash());
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
        let pb = await this._persistence.getBlockByHash(cb.getPreviousHash(), cb.getBlockchain());
        // console.log({pb})
        if (pb) markedTxs = concat(markedTxs, pb.getMarkedTxsList());
      }
    }
    return markedTxs;
  }

  getBlockForMarkedTx(block, mt) {
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
      if (m.getHash() == mt.getHash()) return block.getHeight();
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