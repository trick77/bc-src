'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/*
 * Copyright (c) 2017-present, Block Collider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const os = require('os');
const { fork, ChildProcess } = require('child_process');
const { writeFileSync } = require('fs');
const { resolve } = require('path');
const { config } = require('../config');
const { getMaxDistanceWithEmblems } = require('../core/txUtils');
const QueueEventEmitter = require('queue-event-emitter');
const { EventEmitter } = require('events');
const fkill = require('fkill');

const debug = require('debug')('bcnode:mining:pool');
const crypto = require('crypto');
const { max } = require('ramda');

const { getLogger } = require('../logger');

const MINER_POOL_WORKER_PATH = resolve(__filename, '..', '..', 'mining', 'thread.js');
const BC_MAX_WORKERS = process.env.BC_MAX_WORKERS;
const BC_SUPER_COLLIDER = process.env.BC_SUPER_COLLIDER ? process.env.BC_SUPER_COLLIDER.toLowerCase() : 'bc';

class WorkerPool {

  constructor(persistence, opts) {
    let maxWorkers = os.cpus().length;
    if (opts !== undefined && opts.maxWorkers !== undefined) {
      maxWorkers = opts.maxWorkers;
    }

    if (maxWorkers > 16) {
      maxWorkers = 16;
    }

    if (BC_MAX_WORKERS !== undefined) {
      maxWorkers = parseInt(BC_MAX_WORKERS, 10);
    }
    this._logger = getLogger(__filename);
    this._session = crypto.randomBytes(32).toString('hex');
    this._minerKey = opts.minerKey;
    this._persistence = persistence;
    this._poolGuardPath = opts.poolguard || config.persistence.path + '/worker_pool_guard.json';
    this._maxWorkers = max(1, maxWorkers - 1);
    this._startupCheck = false;
    this._pendingTimeouts = {};
    this._workers = {};
    // attempt to use the emitter in engine
    if (opts.emitter) {
      this._emitter = opts.emitter;
    } else {
      this._emitter = new QueueEventEmitter();
    }

    setInterval(async () => {

      let perf = 0;
      const emblemPerformance = await getMaxDistanceWithEmblems(this._minerKey, this.persistence);
      if (emblemPerformance) {
        // bonus minus default
        perf = max(0, (emblemPerformance.emblemBonus - 2) / emblemPerformance.emblemBonus * 100);
        if (perf > 0) {
          perf = parseFloat(perf).toFixed(2);
        }
      }

      if (perf && Number(perf) > 0) {
        const update = {
          minerKey: this._minerKey,
          emblemPerformance: perf,
          type: 'config',
          maxWorkers: this._maxWorkers
        };
        await this._sendMessage(update);
      }
    }, 10 * 60 * 1000);
  }

  get emitter() {
    return this._emitter;
  }

  get persistence() {
    return this._persistence;
  }

  get pool() {
    return this._pool;
  }

  /*
   * Boot workers
   */
  async allRise({ minerKey, emblemPerformance }) {
    debug(`allRise()`);
    const pool = fork(MINER_POOL_WORKER_PATH);
    pool.on('message', this._handlePoolMessage.bind(this));
    pool.on('error', this._handlePoolError.bind(this));
    pool.on('exit', this._handlePoolExit.bind(this));
    this._minerKey = minerKey;

    pool.send({
      minerKey: minerKey,
      emblemPerformance: emblemPerformance,
      type: 'config',
      maxWorkers: this._maxWorkers
    });
    this._pool = pool;

    this.emitter.emit('ready');
    debug('allRise()');
    return Promise.resolve(true);
  }

  async _sendMessage(msg) {
    try {
      // if(this._workers[pid] !== undefined && this._workers[pid].connected){
      await this._pool.send(msg);
      // }
      return Promise.resolve(true);
    } catch (err) {
      this._logger.info('unable to send message to worker');
      this._logger.error(err);
      this._pool = this._scheduleNewPool();
      this._pool.once('online', () => {
        this._pool.send(msg);
      });
      return;
    }
    return Promise.resolve(true);
  }

  updateWorkers(msg) {
    return this._sendMessage(msg);
  }

  async dismissWorker(worker) {
    if (worker === undefined) {
      return Promise.resolve(true);
    }
    worker = this._workers[worker.pid];

    if (!worker) {
      return true;
    }

    if (worker.connected) {
      try {
        worker.disconnect();
      } catch (err) {
        this._logger.info(`unable to disconnect workerProcess, reason: ${err.message}`);
      }
    }

    try {
      worker.removeAllListeners();
    } catch (err) {
      this._logger.info(`unable to remove workerProcess listeners, reason: ${err.message}`);
    }

    // $FlowFixMe
    if (worker !== undefined && worker.killed !== true) {
      try {
        worker.kill();
      } catch (err) {
        this._logger.info(`Unable to kill workerProcess, reason: ${err.message}`);
      }
    }

    if (this._workers[worker.pid]) {
      delete this._workers[worker.pid];
    }

    return true;
  }

  _scheduleNewPool() {
    const pool = fork(MINER_POOL_WORKER_PATH);
    pool.on('message', this._handlePoolMessage.bind(this));
    pool.on('error', this._handlePoolError.bind(this));
    pool.on('exit', this._handlePoolExit.bind(this));
    pool.send({ minerKey: this._minerKey, type: 'config', maxWorkers: this._maxWorkers });
    this._pool = pool;

    this.emitter.emit('ready');
    return pool;
  }

  async _handlePoolMessage(msg) {
    /*
     * { type: 'solution',
     *   data: {
     *    distance: '',
     *    nonce: '',
     *    timestamp: ''
     *   },
     *   workId: '000000'
     * }
     *
     */
    if (msg === undefined) {
      // strange unrequested feedback from worker
      // definately throw and likely exit
      this._logger.warn('unable to parse message from worker pool');
    } else if (msg.type === 'solution') {
      // handle block
      debug('collision discovered: ' + msg.workId);
      if (msg.data !== undefined && msg.workId !== undefined) {
        msg.data.workId = msg.workId;
        this.emitter.emit('mined', msg.data);
      }
    } else if (msg.type === 'accept') {
      if (this._pendingTimeouts[msg.workId]) {
        //clearTimeout(this._pendingTimeouts[msg.workId])
        //this._pendingTimeouts[msg.workId] = null
        //delete this._pendingTimeouts[msg.workId]
      }
      debug(`cluster manager accepted work ${msg.workId}`);
    }
  }

  _handlePoolError(msg) {
    console.trace(`mining pool error`);
    console.trace(msg);
    return true;
  }

  _handlePoolExit(exitCode) {
    this._logger.error(`worker pool exited: ${exitCode}`);
    // worker ahs exited
    this._pool = this._scheduleNewPool();
  }
}
exports.WorkerPool = WorkerPool;