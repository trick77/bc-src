'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TxMemPool = exports.BC_WAYPOINT_THROTTLE_SEC = undefined;

var _decimal = require('decimal.js');

/**
 * Copyright (c) 2017-present, Block Collider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
_decimal.Decimal.set({ toExpPos: 100 });
_decimal.Decimal.set({ toExpNeg: -100 });
const BN = require('bn.js');
const FastPriorityQueue = require('fastpriorityqueue');

const { calcTxFee } = require('bcjs/dist/transaction');
const { getTransactionSize } = require('bcjs/dist/utils/protoUtil');

const { getLogger } = require('../logger');
const { BASE_BLOCK_SIZE } = require('../core/txUtils');
const PersistenceRocksDb = require('../persistence').RocksDb;
const { Transaction, OutPoint } = require('../protos/core_pb');
const debug = require('debug')('bcnode:txPendingPool');
const debugSpent = require('debug')('bcnode:txPendingPool:spent');
const debugFee = require('debug')('bcnode:txPendingPool:fee');

const BOSON_PER_BYTE = new _decimal.Decimal('16600000000000');

const BC_TX_PENDING_POOL_SIZE = 10000;
// export const BC_TX_PENDING_POOL_MIN = isNaN(process.env.BC_TX_PENDING_POOL_MIN) ? 9990 : Number(process.env.BC_TX_PENDING_POOL_MIN)
// export const BC_TX_PENDING_POOL_MAX = isNaN(process.env.BC_TX_PENDING_POOL_MAX) ? 36600 : Number(process.env.BC_TX_PENDING_POOL_MAX)
const BC_WAYPOINT_THROTTLE_SEC = exports.BC_WAYPOINT_THROTTLE_SEC = isNaN(process.env.BC_WAYPOINT_THROTTLE_SEC) ? 17 : Number(process.env.BC_WAYPOINT_THROTTLE_SEC);

const getRandomRange = (min, max, num) => {
  if (!num) {
    num = 1;
  }
  return Math.floor((Math.random() * (max - min + 1) + min) / num);
};

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
      debugFee(`${tx.hash} has been removed - ${removed}, size is now ${this._data.size}`);
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

  constructor(persistence, relayMode) {
    this._persistence = persistence;
    this._logger = getLogger(__filename);
    this._txMemPool = new TxMemPool();
    this._outPointPool = new OutPointPool();
    this._txChecked = new Map();
    this._startUpTime = Math.floor(Date.now() / 1000);
    this._txPoolRandomLimit = BC_TX_PENDING_POOL_SIZE;
    this._txsByWaypoint = {};
    this._waypointThrottledTimes = {};
    this._relayMode = relayMode;
  }

  getSummary() {
    const now = Math.floor(Date.now() / 1000);
    const obj = {};
    obj.txPoolLimit = this._txPoolRandomLimit;
    obj.dataSize = this._txMemPool._data.size > this._txPoolRandomLimit;
    obj.pendingWaypoints = Object.keys(this._waypointThrottledTimes).length;
    obj.secondsElapsedSinceStart = now - this._startUpTime;
    return obj;
  }

  // checks if waypoint is throttled
  isWaypointThrottled(waypointAddress) {

    const now = Math.floor(Date.now() / 1000);
    if (this._waypointThrottledTimes[waypointAddress]) {
      if (this._waypointThrottledTimes[waypointAddress] + BC_WAYPOINT_THROTTLE_SEC <= now) {
        delete this._waypointThrottledTimes[waypointAddress];
        return false;
      }
      return true;
    } else {

      // log the waypoint sending a tx
      this._recordWaypointTx(waypointAddress);

      // clean up any unthrottled nodes
      for (let w in Object.keys(this._waypointThrottledTimes)) {
        if (this._waypointThrottledTimes[w] + BC_WAYPOINT_THROTTLE_SEC <= now) {
          delete this._waypointThrottledTimes[w];
        }
      }
      return false;
    }
  }

  _recordWaypointTx(waypointAddress) {

    // check if this window has been set, if not set it
    const w = Math.floor(Math.floor(Date.now() / 1000) / 5);
    if (!this._txsByWaypoint[w]) {
      // if not set set the window and remove the previous
      for (let k in Object.keys(this._txsByWaypoint)) {
        delete this._txsByWaypoint[k];
      }
      this._txsByWaypoint[w] = {};
    }

    // if a waypoint address is added
    if (waypointAddress) {
      if (!this._txsByWaypoint[w][waypointAddress]) {
        this._txsByWaypoint[w][waypointAddress] = 1;
      } else {
        this._txsByWaypoint[w][waypointAddress]++;
        if (this._txsByWaypoint[w][waypointAddress] > Math.floor(this._txPoolRandomLimit / 280)) {
          this.throttleWaypoint(waypointAddress);
        }
      }
    }
  }

  // set waypoint
  throttleWaypoint(waypoint) {
    this._logger.info(`waypoint in tx pool pending state`);
    const now = Math.floor(Date.now() / 1000);
    this._waypointThrottledTimes[waypoint] = now;
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
        debugSpent(`${outpoint.getHash()}.${outpoint.getIndex()} has been spent`);
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
      let feePerByte = fee.div(getTransactionSize(tx));
      this._txMemPool.del({ hash: tx.getHash(), fee, feePerByte, tx, txSize });
    }
    this._txMemPool.trim();
    return true;
  }
  getByteFeeMultiplier() {
    let fee = new _decimal.Decimal(1);
    if (this._txMemPool._data.size > 100) {
      fee = (0, _decimal.Decimal)(Math.pow(100, this._txMemPool._data.size / this._txPoolRandomLimit));
    }
    return fee.toFixed(5).toString();
  }
  isFull() {
    return this._outPointPool._data.size > this._txPoolRandomLimit || this._txMemPool._data.size > this._txPoolRandomLimit;
  }

  async tryAddingNewTx(tx, checkFee) {
    if (this._relayMode) {
      return true;
    }

    if (tx.getInputsList().length === 0) {
      // this._logger.info(`Tx ${tx.getHash()} cannot have 0 inputs`)
      return false;
    }

    //check the transaction fee exceeds the current fee
    let feePerByte = calcTxFee(tx).div(getTransactionSize(tx));
    //
    // console.log(new Decimal(this.getByteFeeMultiplier()).mul(BOSON_PER_BYTE).round())
    // console.log(new BN(new Decimal(this.getByteFeeMultiplier()).mul(BOSON_PER_BYTE).round().toString()))
    let isUnlock = false;
    if (checkFee && tx.getInputsList().length === 1) {
      try {
        let isWithinSettlement = await this._persistence.isTxWithinSettlement(tx.getInputsList()[0].getOutPoint().getHash(), tx.getInputsList()[0].getOutPoint().getIndex());
        if (!isWithinSettlement) isUnlock = true;
      } catch (err) {
        debugFee(`Tx ${tx.getHash()} is not an unlock order`);
      }
    }

    if (!isUnlock && checkFee && feePerByte.lt(new BN(new _decimal.Decimal(this.getByteFeeMultiplier()).mul(BOSON_PER_BYTE).round().toString()))) {
      debugFee(`Tx ${tx.getHash()} fee per byte ${feePerByte.toString()} is less than current requirement - ${new _decimal.Decimal(this.getByteFeeMultiplier()).mul(BOSON_PER_BYTE).round().toString()}`);
      return false;
    }
    // check if tx size in bytes is lower than 2/3 of BASE_BLOCK_SIZE
    const txSize = tx.serializeBinary().length;
    if (Math.floor(BASE_BLOCK_SIZE / 3 * 2) < txSize) {
      debug(`Tx ${tx.getHash()} size ${txSize} is bigger than ${Math.floor(BASE_BLOCK_SIZE / 3 * 2)}`);
      return false; // TODO should end with error stating what happened
    }

    for (let input of tx.getInputsList()) {
      if (this.isBeingSpent(input.getOutPoint())) {
        debug(`Tx ${tx.getHash()} size ${txSize} has an input being spent`);
        return false;
      }
    }
    // claim the outpoints being spent in this tx
    for (let input of tx.getInputsList()) {
      this._outPointPool.add(input.getOutPoint(), tx);
    }
    let fee = calcTxFee(tx);

    this._txMemPool.add({ hash: tx.getHash(), fee, feePerByte, tx, txSize });
    debug(`adding tx to the pending pool: ${tx.getHash()}`);
    debug({ hash: tx.getHash(), fee, feePerByte });
    return true;
  }

}
exports.default = TxPendingPool;