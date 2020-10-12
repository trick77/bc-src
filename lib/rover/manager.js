'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const { fork } = require('child_process');
const { glob } = require('glob');
const fs = require('fs');
const path = require('path');
const { all, evolve, flatten, groupBy, identity, values, min } = require('ramda');

const QueueEventEmitter = require('queue-event-emitter');
const debugFactory = require('debug');
const debug = debugFactory('bcnode:rover:manager');
const logging = require('../logger');
const { errToString } = require('../helper/error');
const { Block } = require('../protos/core_pb');
const { RoverMessage, RoverMessageType } = require('../protos/rover_pb');
const { ROVER_RESYNC_PERIOD, ROVER_SECONDS_PER_BLOCK } = require('./utils');
const { RpcClient } = require('../rpc');
const { parseBoolean } = require('../utils/config');

const BC_NETWORK = process.env.BC_NETWORK || 'main';
const ROVER_RESTART_TIMEOUT = 25000;
const ROVED_DATA_PATH = path.resolve(__dirname, '..', '..', '_debug');
const BC_PREVENT_INITIAL_SYNC = parseBoolean(process.env.BC_PREVENT_INITIAL_SYNC);
const ROVER_DF_VOID_EXIT_CODE = exports.ROVER_DF_VOID_EXIT_CODE = 16;

/**
 * Rover lookup table
 *
 * Gets the rover path by name of it
 */
const rovers = exports.rovers = {
  btc: path.resolve(__dirname, 'btc', 'rover.js'),
  eth: path.resolve(__dirname, 'eth', 'rover.js'),
  lsk: path.resolve(__dirname, 'lsk', 'rover.js'),
  neo: path.resolve(__dirname, 'neo', 'rover.js'),
  wav: path.resolve(__dirname, 'wav', 'rover.js')

  /**
   * Rover manager
   */
};class RoverManager {

  constructor(persistence, emitter, roverEmitter) {
    this._logger = logging.getLogger(__filename);
    this._rovers = {};
    this._emitter = emitter;
    this._roverEmitter = roverEmitter;
    this._persistence = persistence;
    this._roverConnections = {};
    this._roverBootstrap = {};
    this._roverSyncStatus = Object.keys(rovers).reduce((all, k) => {
      all[k] = false;
      return all;
    }, {});
    this._timeouts = {};
  }

  get rovers() {
    return this._rovers;
  }

  roverRpcJoined(call) {
    const roverName = call.request.getRoverName();
    this._logger.debug(`Rover ${roverName} joined using gRPC`);
    // TODO check if connection not already present
    this._roverConnections[roverName] = call;
  }

  setRoverSyncStatus(call, cb) {
    const rover = call.request.getRoverName();
    const isSynced = call.request.getStatus();
    debug(`Rover ${rover} reporting sync status: ${isSynced}`);
    this._logger.info(`${rover} sync finished, validating the block sequence`);
    this._roverSyncStatus[rover] = isSynced;
    this._emitter.emit('roverSyncStatus', { rover, status: isSynced });
    cb();
  }

  setRoverBlockRange(call, cb) {
    /*
     * RoverBlockRange Proto
     *  {
     *    getRoverName
     *    getHighestHeight
     *    getLowestHeight
     *    getHighestHash
     *    getLowestHash
     *  }
     */
    const roverName = call.request.getRoverName();
    this._logger.debug(`block range recieved from ${roverName} rover`);
    this._emitter.emit('roverBlockRange', call.request);
    cb();
  }

  areRoversSynced() {
    debug(`_roverSyncStatus: %O`, this._roverSyncStatus);
    return all(identity, values(this._roverSyncStatus));
  }

  /**
   * Start rover
   * @param roverName Name of rover to start
   * @returns {boolean} result
   */
  async startRover(roverName, restarted = false, forceResync = false) {
    const roverPath = rovers[roverName];

    if (!roverPath) {
      this._logger.error(`rover is not implemented '${roverName}'`);
      return false;
    }

    this._logger.info(`deploying rover '${roverName}' to '${BC_NETWORK}net' using '${roverPath}'`);
    const rover = fork(roverPath, [], {
      execArgv: []
    });
    this._logger.info(`rover started '${roverName}'`);
    this._rovers[roverName] = rover;
    this._roverSyncStatus[roverName] = false;

    if (restarted || !BC_PREVENT_INITIAL_SYNC) {
      let now = Date.now();
      if (forceResync) {
        now = now - ROVER_RESYNC_PERIOD * 1000;
      }
      const needsResyncData = await this._persistence.getDecisivePeriodOfCrossChainBlocksStatus(now, [roverName]);
      let resyncDataForDebug = {};
      if (debugFactory.enabled('bcnode:rover:manager')) {
        resyncDataForDebug = evolve({ latestBlock: b => b ? b.toObject() : b, intervals: is => is.map(([from, to]) => [from.toObject(), to.toObject()]) }, needsResyncData[roverName]);
      }

      if (needsResyncData[roverName] && forceResync) {
        needsResyncData[roverName].synced = false;
      }
      // debug(`deciding if rover needs resyncing %O`, resyncDataForDebug)
      if (needsResyncData[roverName] && !needsResyncData[roverName].synced) {
        debug('Rover %s sent "needs_resync" message %O', roverName, resyncDataForDebug);
        this.messageRover(roverName, 'needs_resync', needsResyncData[roverName]);
      } else if (forceResync) {
        this._logger.info(`${roverName} resync requested directly`);
        this.messageRover(roverName, 'needs_resync', needsResyncData[roverName]);
      }
    }

    rover.on('error', () => {
      const { inspect } = require('util');
      this._logger.warn(`rover ${roverName} error handler. args: ${inspect(arguments, { depth: 5 })}`);
    });

    rover.on('exit', (code, signal) => {
      this._logger.warn(`rover ${roverName} exited (code: ${code}, signal: ${signal}) - restarting in ${ROVER_RESTART_TIMEOUT / 1000}s`);
      delete this._rovers[roverName];
      this._roverConnections[roverName] && this._roverConnections[roverName].end();
      delete this._roverConnections[roverName];
      delete this._roverBootstrap[roverName];
      this._roverSyncStatus[roverName] = false;
      // TODO ROVER_RESTART_TIMEOUT should not be static 5s but probably some exponential backoff series separate for each rover
      if (code !== ROVER_DF_VOID_EXIT_CODE && !BC_PREVENT_INITIAL_SYNC) {
        setTimeout(() => {
          this.startRover(roverName, true);
        }, ROVER_RESTART_TIMEOUT);
      }
    });

    return true;
  }

  async messageRover(roverName, message, payload) {
    debug('messageRover() %s -> rover %s', message, roverName);
    const roverRpc = this._roverConnections[roverName];
    if (!roverRpc) {
      // This is necessary to prevent fail while rovers are starting - once we
      // try to resend message after 10s, if it fails for the second time, bail
      // with error as usual
      if (!this._roverBootstrap[roverName]) {
        this._logger.debug(`Retrying messageRover() after 10s - rover not booted yet`);
        this._roverBootstrap[roverName] = true;
        setTimeout(() => {
          this.messageRover(roverName, message, payload);
        }, 15000);
        return;
      }
      //throw new Error(`${roverName} rover's gRPC not running`)
      return;
    }

    const msg = new RoverMessage();
    switch (message) {
      case 'needs_resync':
        const resyncPayload = new RoverMessage.Resync();
        msg.setType(RoverMessageType.REQUESTRESYNC);
        const lb = await this._persistence.get(`${roverName}.block.latest`);
        resyncPayload.setLatestBlock(lb);
        const intervalsFetchBlocks = payload.intervals.map(([from, to]) => {
          const i = new RoverMessage.Resync.Interval();
          i.setFromBlock(from);
          i.setToBlock(to);
          return i;
        });
        resyncPayload.setIntervalsList(intervalsFetchBlocks);
        msg.setResync(resyncPayload);
        roverRpc.write(msg);
        // TODO: This logic is being migrated to ChainState
        this._roverSyncStatus[roverName] = false;
        break;

      case 'fetch_block':
        if (!payload) {
          throw new Error(`For fetch_block payload has to be provided, ${payload} given`);
        }
        const fetchBlockPayload = new RoverMessage.FetchBlock();
        fetchBlockPayload.setFromBlock(payload.previousLatest);
        fetchBlockPayload.setToBlock(payload.currentLatest);
        msg.setType(RoverMessageType.FETCHBLOCK);
        msg.setResync(fetchBlockPayload);
        roverRpc.write(msg);
        break;

      case 'open_block_range_request':
        if (!payload) {
          throw new Error(`open_block_range_request payload not provided <- ${payload} received`);
        }

        this._logger.info(`sending rover block range request highest ${payload.getRoverBlockRange().getHighestHeight()} lowest ${payload.getRoverBlockRange().getLowestHeight()}`);
        roverRpc.write(payload);
        break;

      default:
        throw new Error(`Unknown message ${message}`);
    }
  }

  /**
   * Kill all rovers managed by this manager
   * @return {*} Promise
   */
  killRovers() {
    const roverNames = Object.keys(this._rovers);
    roverNames.map(roverName => {
      this._killRover(roverName);
    });

    return Promise.resolve(true);
  }

  replay() {
    debug('Replaying roved blocks');

    const pattern = path.join(ROVED_DATA_PATH, '**/unified/*.json');
    let files = glob.sync(pattern);

    const groups = groupBy(p => {
      const parts = p.split(path.sep);
      return parts[parts.length - 4];
    })(files);

    const tmp = Object.keys(groups).map(k => {
      return groups[k].slice(-1);
    }) || [];

    // $FlowFixMe
    files = flatten(tmp).sort((a, b) => {
      const fnameA = path.posix.basename(a);
      const fnameB = path.posix.basename(b);

      if (fnameA < fnameB) {
        return -1;
      } else if (fnameA > fnameB) {
        return 1;
      }

      return 0;
    });

    const rpc = new RpcClient();

    files.forEach(f => {
      const json = fs.readFileSync(f).toString();
      const obj = JSON.parse(json);
      const block = new Block();
      block.setBlockchain(obj.blockchain);
      block.setHash(obj.hash);
      block.setPreviousHash(obj.previousHash);
      block.setTimestamp(obj.timestamp);
      block.setHeight(obj.height);
      block.setMerkleRoot(obj.merkleRoot);

      debug(`Replaying roved block`, f, obj);

      rpc.rover.collectBlock(block, err => {
        if (err) {
          this._logger.error(err);
          debug(`Unable to collect block ${f}`, err);
        } else {
          this._logger.error(`collected block from ${obj.blockchain}`);
          debug('recieved block from ' + obj.blockchain);
        }
      });
    });
  }

  /**
   * Kill rover managed by this manager by its name
   * @param roverName
   * @private
   */
  _killRover(roverName) {
    this._roverConnections[roverName] && this._roverConnections[roverName].end();
    delete this._roverConnections[roverName];
    delete this._roverBootstrap[roverName];
    this._roverSyncStatus[roverName] = false;
    const { pid } = this._rovers[roverName];
    this._logger.info(`dismissing rover '${roverName}', pid: ${pid}`);
    try {
      process.kill(pid, 'SIGHUP');
    } catch (err) {
      this._logger.warn(`rover '${roverName}' unable to gracefully shutdown, pid: ${pid}, error: ${errToString(err)}`);
    }
  }
}

exports.RoverManager = RoverManager;
exports.default = RoverManager;