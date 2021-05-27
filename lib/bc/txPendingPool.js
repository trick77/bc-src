'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

const BN = require('bn.js'); /**
                              * Copyright (c) 2017-present, Block Collider developers, All rights reserved.
                              *
                              * This source code is licensed under the MIT license found in the
                              * LICENSE file in the root directory of this source tree.
                              *
                              * 
                              */

const FastPriorityQueue = require('fastpriorityqueue');

const { calcTxFee } = require('bcjs/dist/transaction');
const { getLogger } = require('../logger');
const { BASE_BLOCK_SIZE } = require('../core/txUtils');
const PersistenceRocksDb = require('../persistence').RocksDb;
const { Transaction, OutPoint } = require('../protos/core_pb');
const debug = require('debug')('bcnode:txPendingPool');

const baseOnFunc = (a, b) => {
  if (a.fee.eq(b.fee)) {
    return a.arrival - b.arrival;
  } else return a.fee.cmp(b.fee);
};

class OutPointPool {

  constructor() {
    this._data = new Map();
  }

  add(outpoint, tx) {
    let key = `${outpoint.getHash()}.${outpoint.getIndex()}`;
    if (this._data.has(key)) return;
    this._data.set(key, `${tx.getHash()}`);
  }

  del(outpoint) {
    let key = `${outpoint.getHash()}.${outpoint.getIndex()}`;
    this._data.delete(key);
    return;
  }

  isBeingSpent(outpoint) {
    let key = `${outpoint.getHash()}.${outpoint.getIndex()}`;
    return this._data.has(key);
  }
}

class TxMemPool {

  constructor() {
    this._data = new FastPriorityQueue((a, b) => {
      if (a.feePerByte.eq(b.feePerByte)) {
        //sort by fee per byte first
        if (a.fee.eq(b.fee)) {
          // then by total fee
          return a.hash < b.hash; // then by hash
        } else {
          return a.fee.gt(b.fee);
        }
      } else {
        return a.feePerByte.gt(b.feePerByte);
      }
    });
    this._txHashSet = new Set();
  }

  add(tx) {
    if (this._txHashSet.has(tx.hash)) return;
    this._data.add(tx);
    this._txHashSet.add(tx.hash);
    return;
  }
  trim() {
    this._data.trim();
    return;
  }
  del(tx) {
    if (this._txHashSet.has(tx.hash)) {
      this._txHashSet.delete(tx.hash);
      let removed = this._data.remove(tx);
    }
    return;
  }

  returnAllTxs() {
    return this._data.array.map(({ tx }) => {
      return tx;
    });
  }

  loadBestPendingTxs(number) {
    if (number >= this._data.size) {
      return this._data.array.map(({ tx }) => {
        return tx;
      });
    } else {
      return this._data.kSmallest(number).map(({ tx }) => {
        return tx;
      });
    }
  }
}

exports.TxMemPool = TxMemPool;
class TxPendingPool {

  constructor(persistence) {
    this._persistence = persistence;
    this._logger = getLogger(__filename);
    this._txMemPool = new TxMemPool();
    this._outPointPool = new OutPointPool();
    this._txChecked = new Map();
  }

  isBeingSpent(outPoint) {
    return this._outPointPool.isBeingSpent(outPoint);
  }

  async isAnyInputSpent(tx) {
    // let spentStatus = await Promise.all(tx.getInputsList().map((input)=>{
    //   const outpoint = input.getOutPoint()
    //   return this._persistence.isOutPointUnspent(outpoint.getHash(), outpoint.getIndex())
    // }))
    let spentStatus = false;
    let inputs = tx.getInputsList();

    for (let i = 0; i < inputs.length; i++) {
      const outpoint = inputs[i].getOutPoint();
      let spent = await this._persistence.isOutPointUnspent(outpoint.getHash(), outpoint.getIndex());
      if (!spent) {
        debug(`${outpoint.getHash()}.${outpoint.getIndex()} has been spent`);
        spentStatus = true;
      }
    }
    debug({ spentStatus, hash: tx.getHash() });
    return spentStatus;
  }

  getRawMempool() {
    return this._txMemPool.returnAllTxs();
  }

  async loadBestPendingTxs(number, lastBlock) {
    let nlargest = this._txMemPool.loadBestPendingTxs(number * 2);

    let lastHash = lastBlock.getHash();

    if (!this._txChecked[lastHash]) {
      this._txChecked.clear();
      this._txChecked[lastHash] = true;
    }
    // ensure txs cannot be spending the same outpoint
    let outpoints = {};
    let remove = [];
    nlargest = nlargest.filter(tx => {
      let newTx = true;
      for (let input of tx.getInputsList()) {
        let key = `${input.getOutPoint().getHash()}.${input.getOutPoint().getIndex()}`;
        if (outpoints[key]) {
          remove.push(tx);
          newTx = false;
        } else {
          outpoints[key] = true;
        }
      }
      return newTx;
    });

    let prevTxs = lastBlock.getTxsList().map(tx => {
      return tx.getHash();
    });

    //ensure that txs have not already been spent when being loaded
    let txs = [];
    for (let i = 0; i < nlargest.length; i++) {
      let tx = nlargest[i];
      let isSpent = await this.isAnyInputSpent(tx);
      let isInLastBlock = prevTxs.indexOf(tx.getHash()) !== -1;
      if (isSpent || isInLastBlock) remove.push(tx);else txs.push(tx);
    }

    this.markTxsAsMined(remove);
    return txs;
  }

  markTxsAsMined(txs) {
    for (const tx of txs) {
      for (let input of tx.getInputsList()) {
        this._outPointPool.del(input.getOutPoint());
      }
      let fee = calcTxFee(tx);
      const txSize = tx.serializeBinary().length;
      let feePerByte = fee.div(new BN(txSize.toString()));
      this._txMemPool.del({ hash: tx.getHash(), fee, feePerByte, tx, txSize });
    }
    this._txMemPool.trim();
    return true;
  }
  isFull() {
    return this._outPointPool._data.size > 100000 || this._txMemPool._data.size > 100000;
  }

  tryAddingNewTx(tx) {
    if (tx.getInputsList().length === 0) {
      // this._logger.info(`Tx ${tx.getHash()} cannot have 0 inputs`)
      return false;
    }

    if (this._outPointPool._data.size > 100000 || this._txMemPool._data.size > 100000) {
      this._logger.debug(`TxMemPool size exceeds 100,000`);
      return false;
    }

    // check if tx size in bytes is lower than 2/3 of BASE_BLOCK_SIZE
    const txSize = tx.serializeBinary().length;
    if (Math.floor(BASE_BLOCK_SIZE / 3 * 2) < txSize) {
      this._logger.debug(`Tx ${tx.getHash()} size ${txSize} is bigger than ${Math.floor(BASE_BLOCK_SIZE / 3 * 2)}`);
      return false; // TODO should end with error stating what happened
    }

    for (let input of tx.getInputsList()) {
      if (this.isBeingSpent(input.getOutPoint())) {
        this._logger.debug(`Tx ${tx.getHash()} size ${txSize} has an input being spent`);
        return false;
      }
    }
    // claim the outpoints being spent in this tx
    for (let input of tx.getInputsList()) {
      this._outPointPool.add(input.getOutPoint(), tx);
    }
    let fee = calcTxFee(tx);
    let feePerByte = fee.div(new BN(txSize.toString()));
    this._txMemPool.add({ hash: tx.getHash(), fee, feePerByte, tx, txSize });
    this._logger.info(`adding tx to the pending pool: ${tx.getHash()}`);
    return true;
  }

}
exports.default = TxPendingPool;