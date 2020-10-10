'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});


const { EventEmitter } = require('events'); /*
                                             * Copyright (c) 2017-present, Block Collider developers, All rights reserved.
                                             *
                                             * This source code is licensed under the MIT license found in the
                                             * LICENSE file in the root directory of this source tree.
                                             *
                                             * 
                                             */

const { join } = require('path');

const { config } = require('../config');
const UI_PORT = process.env.BC_UI_PORT && parseInt(process.env.BC_UI_PORT, 10) || config.server.port;
const { ROVER_SECONDS_PER_BLOCK, ROVER_RESYNC_PERIOD } = require('../rover/utils');
const debug = require('debug')('bcnode:bc:chainstate');
const { all, concat } = require('ramda');
const mkdirp = require('mkdirp');
const LRUCache = require('lru-cache');
const { fromASM, toASM } = require('bcjs/dist/script/bytecode');

const { RoverMessage } = require('../protos/rover_pb');
const { Utxo, TransactionOutput } = require('../protos/core_pb');
const { default: MemoryMap } = require('../persistence/memorymap');
const { TextEncoder, TextDecoder } = require('util');
const { getLogger } = require('../logger');

const uint8ToString = u => {
  return new TextDecoder('utf-8').decode(u);
};
const stringToUint8 = s => {
  return new TextEncoder('utf-8').encode(s);
};
const BC_SUPER_COLLIDER = exports.BC_SUPER_COLLIDER = process.env.BC_SUPER_COLLIDER ? process.env.BC_SUPER_COLLIDER.toLowerCase() : 'bc';

const StateRanks = {
  'RESTART': 0,
  'CLOSED': 1,
  'WAIT': 2,
  'SYNC': 3,
  'READY': 4,
  'OPTIMUM': 5

  /*
   * #### State Dictionary
   * All states of the node
   *
   *   - OPTIMUM <- All services are normal, ok to mine, all other purposed branches are considered irrelevant
   *   - READY <- All services are normal, ok to mine, current branch is considered best branch
   *   - SYNC <- All services are normal, cannot mine, current branch is not considered best branch
   *   - WAIT <- A reorg branch has been accepted and the local state is being updated, cannot mine
   *   - RESTART <- Local collider has encountered a critical error from which it could not recover, cannot mine, check error logs and restart
   *   - CLOSED <- The chain state is not available
   *
   * #### Event Registry
   * Events emitted after state changes.
   *
   *   - ${blockchain}_OPEN_BLOCK_RANGE_REQUEST <- Request a range of blocks from given blockchain to be rovered
   *   - ${blockchain}_CLOSE_BLOCK_RANGE_REQUEST <- Remove the requested range of blocks for a given blockchain
   *   - ${blockchain}_PUT_LATEST_BLOCK_HEIGHT <- New block latest head outside not a part of sync (emitted when sync is complete)
   *   - ${blockchain}_PUT_RANGE_HIGHEST_HEIGHT <- New highest height added range requests
   *   - ${blockchain}_PUT_RANGE_LOWEST_HEIGHT <- New lowest height updated range request
   *   - ${blockchain}_PUT_RANGE_HIGHEST_HASH <- New highest hash updated range request
   *   - ${blockchain}_PUT_RANGE_LOWEST_HASH <- New lowest hash updated range request
   *   - ${blockchain}_PUT_STATE <- New state for given blockchain
   *   - PUT_STATE <- Update to global collider state
   *   - MINER_UPDATE <- New update requesting working threads restart on new heights
   *   - MINER_WAIT <- A resync request is approved and the miner should wait until a LATEST_BLOCK_HEIGHT is emitted
   *   - PUT_STATE_CLOSE <- Chainstate has closed the allocated memory map.
   *   - SETUP_COMPLETE <- Chainstate has made all operations and it is not safe to write to
   *
   * #### Flow 1: Startup
   *
   *   - ChainState starts in a state of "PRELUDE" for bc chain and all connected rover chains
   *   - All rovers report to mining office the range of blocks they must initially sync
   *   - the Mining Officer checks if there is a range request already opened and relay that back to the rover (possibly causing it to update it's sync schedule)
   *   - ChainState opens the ranges sent by the mining office and enters of the sync status for each blockchain as they come in.
   *
   * #### Flow 2: Multiverse
   *
   *   - A missing block range is detected after a rover submits a block which does not connect to previous segments
   *   - A block range request is opened on ChainState
   *   - ChainState emits a new open block range request
   *   - Mining Office listening sends the range request to the relavent rovers
   *   - Each rover takes the range and either updates it's current queued blocksToFetch or adds the range to the front of blocks to fetch.
   *   - Once the rover has found the completed range it emits this back to the mining officer who evaluates it in the multiverse to see if it should be a rebranch
   *   - If range is a valid better branch chainstate is notified with a second argument validReorg = true which means that latest block event is updates to reflect the right height
   *
   * #### Flow 3: Block Path
   *
   *   - block created in ${rover}.createUnifiedBlock
   *   - block streamed via gRPC to RoverClient proto src/protos/rover_grpc_pb
   *
   */

};class ChainState extends EventEmitter {

  /*
   * ChainState Class
   *
   * path, opts {
   *    writable: instatiate ChainStae with the ability to write to it [default: false]
   *    state: force override any current or default startup state if set [default 'SYNC']
   *    p2p: permit networking with other nodes [default: true]
   * }
   *
   */

  constructor(dirPath, rovers, opts = {}) {
    super();

    this._logger = getLogger(__filename);
    mkdirp.sync(dirPath);
    const name = opts.name ? opts.name : '.chainstate.db';
    const path = join(dirPath, name);
    this._path = path;
    this._rovers = concat(rovers, [BC_SUPER_COLLIDER]);
    this._writable = !!opts.writable;
    this._p2p = opts.p2p ? opts.p2p : true;
    this._memory = new MemoryMap(path, opts);
    this._logger.info(`connection opened with rovers ${this._rovers} with storage at ${path}`);
    this._utxoCache = new LRUCache({
      max: 200000
    });
    this._addressCache = new LRUCache({
      max: 200000
    });
    const currentState = this._memory.get('state');
    const state = opts.state ? opts.state : 'SYNC';
    if (currentState) {
      if (currentState !== state) {
        // TODO: probable force sync state
        if (opts.state) {
          // force is hard coded
          this._memory.put('state', state);
        }
      }
    } else {
      this._memory.put('state', state);
    }
    if (this._writable) {
      this._logger.info(`pruning state removing range + latest block heights`);
      delete this._memory._memory[`${BC_SUPER_COLLIDER}.work`];
      this._rovers.map(rover => {
        delete this._memory._memory[`${rover}.block.latest.height`];
        delete this._memory._memory[`${rover}.block.latest.hash`];
        delete this._memory._memory[`${rover}.range.highest.height`];
        delete this._memory._memory[`${rover}.range.lowest.height`];
        delete this._memory._memory[`${rover}.range.highest.hash`];
        delete this._memory._memory[`${rover}.range.lowest.hash`];
      });
      // set startup timestamp
      if (this._memory.get('startTimestamp')) {
        this._logger.info(`previous startup detected at: ${this._memory.get('startTimestamp')}`);
        this._memory.put('previousTimestamp', this._memory.get('startTimestamp'));
      }
      this._memory.put('startTimestamp', new Date().toString());
      this.emit('SETUP_COMPLETE');
    }
  }

  get(key) {
    return this._memory.get(key);
  }

  close(removeDiskData = false) {
    this.emit('PUT_STATE_CLOSE');
    return new Promise((resolve, reject) => {
      try {
        const currentState = this._memory.get('state');
        if (currentState !== 'CLOSED') {
          this.emit('PUT_STATE_CLOSE', 'CLOSED');
          return this._memory.close(removeDiskData).then(resolve).catch(reject);
        } else {
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  /*
   * @method getBlockchainState
   * takes the string of the blockchain and returns
   */
  getBlockchainState(blockchain) {
    if (!blockchain) {
      throw new Error(`ERROR: getBlockchainState requires blockchain string (blockchaint)`);
    }
    blockchain = blockchain.toLowerCase();
    if (this._rovers.indexOf(blockchain) < 0) {
      throw new Error(`no "${blockchain}" rovers are streaming to this collider`);
    }

    const rangeHighestHeight = this._memory.get(`${blockchain}.range.highest.height`);
    const rangeLowestHeight = this._memory.get(`${blockchain}.range.lowest.height`);

    // if latest block is not defined false
    const latestBlockHeight = !this._memory.get(`${blockchain}.block.latest.height`) ? false : this._memory.get(`${blockchain}.block.latest.height`);
    const latestBlockHash = !this._memory.get(`${blockchain}.block.latest.hash`) ? false : this._memory.get(`${blockchain}.block.latest.hash`);
    const currentState = this._memory.get(`${blockchain}.state`);
    const requiredMetrics = all(a => a !== undefined && a !== null && a !== false, [currentState, rangeHighestHeight, rangeLowestHeight, latestBlockHeight, latestBlockHash]);
    if (requiredMetrics) {
      const range = rangeHighestHeight - rangeLowestHeight;
      const optimum = Math.abs(range * 2) + rangeHighestHeight;

      // COLLIDER BLOCKCHAIN STATES
      // ________________________________________________
      // RESTART | CLOSED | WAIT | SYNC | READY | OPTIMUM
      // ________________________________________________

      /*
       * STATE: WAIT
       * WAIT is a blocking flag by ChainState which when set means a large state update is occuring which has multiple asynchronous implications
       * miner cannot run, large reorg or pruning update is occuring on disk.
       */
      if (currentState === 'WAIT') {
        return 'WAIT';

        /*
         * STATE: RESTART
         * a critical error has occured process should exit or begin shutdown procedure
         */
      } else if (currentState === 'RESTART') {
        return 'RESTART';

        /*
         * STATE: CLOSED
         * local blockchain state is not available, collider running as headless SDK only
         */
      } else if (currentState === 'CLOSED') {
        return 'CLOSED';

        /*
         * STATE: OPTIMUM (best)
         * latest block height is above optimum threshold optimum threshold is (range * 2) + rangeHighestHeight
         */
      } else if (latestBlockHeight > optimum) {
        if (currentState !== 'OPTIMUM') {
          this._memory.put(`${blockchain}.state`, 'OPTIMUM');
          this.emit(`${blockchain.toUpperCase()}_PUT_STATE`, 'OPTIMUM');
        }
        return 'OPTIMUM';

        /*
         * STATE: READY
         * latest block height is above the latest range requested + 1
         */
      } else if (latestBlockHeight > rangeHighestHeight + 1) {
        if (currentState !== 'READY') {
          this._memory.put(`${blockchain}.state`, 'READY');
          this.emit(`${blockchain.toUpperCase()}_PUT_STATE`, 'READY');
        }
        return 'READY';

        /*
         * STATE: SYNC
         * latest block height is below range requested
         */
      } else if (latestBlockHeight < rangeHighestHeight && rangeHighestHeight - rangeLowestHeight > 4) {
        if (currentState !== 'SYNC') {
          this._memory.put(`${blockchain}.state`, 'SYNC');
          this.emit(`${blockchain.toUpperCase()}_PUT_STATE`, 'SYNC');
        }
        return 'SYNC';
      }
    } else {
      this._logger.debug(`required metrics not available to update global state <- default: SYNC`);
      return 'SYNC';
    }
  }

  /*
   * @method getStateFingerprint
   * collects the unique hash value of the current state of all chain edges
   */
  getStateFingerprint(superCollider = BC_SUPER_COLLIDER) {
    const c = this._memory.get(`${superCollider}.work`) ? this._memory.get(`${superCollider}.work`) : `${superCollider}.work`;
    let synced = true;
    const str = this._rovers.reduce((all, rover) => {
      const syncStatus = this.getSyncStatus(rover);
      const h = this._memory.get(`${rover}.block.latest.height`);
      const hash = this._memory.get(`${rover}.block.latest.hash`);
      if (!syncStatus && rover !== superCollider) {
        synced = false;
      }
      if (h) {
        all = `${all}:${h}`;
      }
      if (hash) {
        all = `${all}:${hash}`;
      }
      return all;
    }, c);
    return `${synced}-${str}`;
  }

  /*
   * @method getState
   * states for all blockchains, global state is set to either all of them if equivalency is achieved or the most common if not
   * uses getBlockchainState for each blockchain
   */
  getState() {
    const report = this._rovers.reduce((all, blockchain) => {
      all[blockchain] = this.getBlockchainState(blockchain);
      return all;
    }, {});

    const standard = report[this._rovers[0]];

    const allStatesReport = Object.keys(report).every(chain => {
      return report[chain] === standard;
    });

    const states = Object.keys(report).reduce((all, chain) => {
      all.push(report[chain]);
      return all;
    }, []);

    const currentState = this._memory.get('state');

    if (allStatesReport && standard !== currentState) {
      this._memory.put('state', standard);
      this.emit(`PUT_STATE`, standard);
    } else {
      if (states.indexOf('SYNC') < 0 && states.indexOf('RESTART') < 0 && states.indexOf('WAIT') < 0) {
        if (currentState !== 'READY') {
          this._memory.put('state', 'READY');
          this.emit(`PUT_STATE`, 'READY');
        }
      } else {
        // Select the most common state
        const counts = Object.keys(report).reduce((all, item) => {
          if (!all[item]) {
            all[item] = 1;
          } else {
            all[item]++;
          }
          return all;
        }, {});

        const highest = Object.keys(counts).reduce((all, chain) => {
          if (!all) {
            all = { chain: chain, count: counts[chain] };
          } else if (counts[chain] > all.count) {
            all = { chain: chain, count: counts[chain] };
          }
          return all;
        }, false);

        if (currentState !== report[highest.chain]) {
          this._memory.put('state', report[highest.chain]);
          this.emit(`PUT_STATE`, report[highest.chain]);
        }
      }
    }
    return report;
  }

  /*
   * @method putLatestBlock
   * valid new block extending local disk blockchain
   */
  putLatestBlock(blockchain, height, hash, force = false) {
    if (!blockchain) {
      throw new Error(`ERROR: putLatestBlock requires blockchain string (blockchain, height, hash)`);
    }
    blockchain = blockchain.toLowerCase();
    if (!height) {
      throw new Error(`ERROR: putLatestBlock requires block height (blockchain, height, hash)`);
    }
    if (!hash) {
      throw new Error(`ERROR: putLatestBlock requires block hash (blockchain, height, hash)`);
    }
    // DEBUG
    debug(`putLatestBlock(): ${blockchain} ${height} ${hash}`);
    this._memory.put(`${blockchain}.block.latest.height`, height);
    this._memory.put(`${blockchain}.block.latest.hash`, hash);
    this.emit(`${blockchain.toUpperCase()}_LATEST_BLOCK_HEIGHT`, height);
    this.emit(`${blockchain.toUpperCase()}_LATEST_BLOCK_HASH`, hash);
  }

  /*
   * @method getSyncStatus
   * the sync status of the
   */
  getSyncStatus(blockchain) {
    if (!blockchain) {
      throw new Error(`ERROR: getSyncStatus requires blockchain string (blockchain)`);
    }
    blockchain = blockchain.toLowerCase();
    const status = this._memory.get(`${blockchain}.status`);
    if (!status) {
      return false;
    }
    if (status === '1') {
      return true;
    }
    if (status === '0') {
      return false;
    }
    return false;
    // DEBUG
  }

  /*
   * @method putSyncStatus
   * the sync status of the
   */
  putSyncStatus(blockchain, status = false) {
    if (!blockchain) {
      throw new Error(`ERROR: putSyncStatus requires blockchain string (blockchain, status)`);
    }
    blockchain = blockchain.toLowerCase();
    if (status === undefined || status === null) {
      throw new Error(`ERROR: putSyncStatus requires block (blockchain, status)`);
    }
    if (typeof status !== 'boolean') {
      throw new Error('ERROR: putSyncStatus argument status must be boolean');
    }
    const numeralStatus = status ? '1' : '0';
    this._memory.put(`${blockchain}.status`, numeralStatus);
    return status;
  }

  /*
   * @method getLatestBlockHeight
   */
  getLatestBlockHeight(blockchain) {
    if (!blockchain) {
      throw new Error('getLatestBlockHeight requires blockchain to request');
    }
    return this._memory.get(`${blockchain}.block.latest.height`);
  }

  /*
   * @method getLatestBlockHash
   */
  getLatestBlockHash(blockchain) {
    return this._memory.get(`${blockchain}.block.latest.hash`);
  }

  /*
   * @method openBlockRangeRequest
   * for the given blockchain requests a range of blocks between and including heights
   * if a reuqest is already open the range heights and hashes are updated on both sides of the request window
   * "bc", [highestBlockHeight, lowestBlockHeight]
   */
  openBlockRangeRequest(blockchain, highest, lowest, opts = {}) {
    if (!blockchain) {
      throw new Error(`ERROR: fetchBlockRange requires blockchain string (blockchain, highest, lowest)`);
    }
    blockchain = blockchain.toLowerCase();
    if (!highest) {
      throw new Error(`ERROR: fetchBlockRange requires highest number (blockchain, highest, lowest)`);
    }
    if (!lowest) {
      throw new Error(`ERROR: fetchBlockRange requires lowest number (blockchain, highest, lowest)`);
    }
    if (this._rovers.indexOf(blockchain) < 0) {
      throw new Error(`no rovers for blockchain ${blockchain} are streaming to this collider`);
    }
    debug(`openBlockRangeRequest(): blockchain ${blockchain} highest: ${highest} lowest: ${lowest}`);
    const report = {
      highestHash: false,
      lowestHash: false,
      highestHeight: false,
      lowestHeight: false,
      notifyRover: opts.forceNotifyRover ? opts.forceNotifyRover : false
    };

    if (!report.notifyRover) {
      this._memory.put(`${blockchain}.rover.notify`, "0");
    }

    const missingBlocks = opts.missingBlocks;
    const lowestHash = opts.lowestHash ? opts.lowestHash : this.getRangeLowestHash(blockchain);
    const highestHash = opts.highestHash ? opts.highestHash : this.getRangeHighestHash(blockchain);
    report.lowestHash = lowestHash;
    report.highestHash = highestHash;
    // TODO: Candidate to delete
    this.emit(`${blockchain.toUpperCase()}_OPEN_BLOCK_RANGE`, [highest, lowest]);
    const rangeSizeLimit = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[blockchain]) * 100;
    const requestedRange = highest - lowest;
    if (BigInt(highest - lowest) > BigInt(rangeSizeLimit) && blockchain !== BC_SUPER_COLLIDER) {
      this._logger.warn(`WARN: requested range ${requestedRange} out of greater than ${rangeSizeLimit} for ${blockchain} rover from ${highest} to ${lowest}`);
    } else if (requestedRange < 1) {
      //this._logger.warn(`open block range must be a vector <- highest !== lowest`)
      debug(`open block range must be a vector <- highest !== lowest`);
      return report;
    }

    // if range.highest.height has not been saved, store in chainstate
    if (!this._memory.get(`${blockchain}.range.highest.height`)) {
      this._memory.put(`${blockchain}.range.highest.height`, highest);
      this._memory.put(`${blockchain}.range.lowest.height`, lowest);
      this.emit(`${blockchain.toUpperCase()}_PUT_RANGE_HIGHEST_HEIGHT`, highest);
      this.emit(`${blockchain.toUpperCase()}_PUT_RANGE_LOWEST_HEIGHT`, lowest);

      report.highestHeight = highest;
      report.lowestHeight = lowest;

      if (highest) {
        const latestHeight = this.getLatestBlockHeight(blockchain);
        if (latestHeight) {
          if (highest > latestHeight + 1 && missingBlocks && missingBlocks.length > 1) {
            debug(`${blockchain} rover is notified because the highest of the range requested ${highest} block is > current LATEST ${latestHeight} + 1`);
            report.notifyRover = true;
            this._memory.put(`${blockchain}.rover.notify`, "1");
          }
        }
      }

      if (highestHash) {
        this._memory.put(`${blockchain}.range.highest.hash`, highestHash);
        report.highestHash = highestHash;
        this.emit(`${blockchain.toUpperCase()}.PUT_RANGE_HIGHEST_HASH`, highestHash);
      }

      if (lowestHash) {
        this._memory.put(`${blockchain}.range.lowest.hash`, lowestHash);
        report.lowestHash = lowestHash;
        this.emit(`${blockchain.toUpperCase()}.PUT_RANGE_LOWEST_HASH`, lowestHash);
      }
    } else {
      const currentLatestHeight = this.getLatestBlockHeight(blockchain);
      const currentHighestHeight = this.getRangeHighestHeight(blockchain);
      let currentLowestHeight = this.getRangeLowestHeight(blockchain);
      // set the default to the current highest height
      report.highestHeight = currentHighestHeight;
      report.lowestHeight = currentLowestHeight;

      if (highestHash && this._memory.get(`${blockchain}.range.highest.hash`)) {
        // interesting rare case <- height is equal but the hash does not match representing a conflicting branch
        const currentHighestHash = this._memory.get(`${blockchain}.range.highest.hash`);
        if (highest === currentHighestHeight && currentHighestHash !== highestHash) {
          this._logger.warn(`multiverse conflict case discovered at block height ${highest} original hash: ${currentHighestHash} new: ${highestHash}`);
          this._memory.put(`${blockchain}.range.highest.hash`, highestHash);
          report.highestHash = highestHash;
        } else if (highest > currentHighestHeight && highestHash) {
          this._memory.put(`${blockchain}.range.highest.hash`, highestHash);
          report.highestHash = highestHash;
          this.emit(`${blockchain.toUpperCase()}.PUT_RANGE_HIGHEST_HASH`, highestHash);
        }
      }

      if (lowestHash && this._memory.get(`${blockchain}.range.lowest.hash`)) {
        // interesting rare case <- height is equal but the hash does not match representing a conflicting branch
        const currentLowestHash = this._memory.get(`${blockchain}.range.lowest.hash`);
        if (lowest === currentLowestHeight && currentLowestHash !== lowestHash) {
          this._logger.warn(`multiverse change case discovered at block height ${lowest} original hash: ${currentLowestHash} new: ${lowestHash}`);
          report.lowestHash = lowestHash;
          this._memory.put(`${blockchain}.range.lowest.hash`, lowestHash);
        } else if (lowest < currentLowestHeight && lowestHash) {
          report.lowestHash = lowestHash;
          this._memory.put(`${blockchain}.range.lowest.hash`, lowestHash);
          this.emit(`${blockchain.toUpperCase()}.PUT_RANGE_LOWEST_HASH`, lowestHash);
        }
      }

      // is the upper bound of the new request higher than a previous requests upper bound
      if (currentHighestHeight && highest > currentHighestHeight + 1) {
        this._memory.put(`${blockchain}.range.highest.height`, highest);
        report.highestHeight = highest;
        this.emit(`${blockchain.toUpperCase()}_PUT_RANGE_HIGHEST_HEIGHT`, highest);
        debug(`${blockchain} rover is notified because the highest of the range requested ${highest} block is > current highest ${currentHighestHeight} + 1`);
        report.notifyRover = true;
        this._memory.put(`${blockchain}.rover.notify`, "1");
        // moving lowest to latest height
        if (currentLatestHeight && currentLatestHeight > lowest) {
          debug(`moved lowest height ${lowest} frame to latest height ${currentLatestHeight}`);
          lowest = currentLatestHeight;
          this._memory.put(`${blockchain}.range.lowest.height`, lowest);
          report.lowestHeight = currentLatestHeight;
        }
      } else if (currentHighestHeight && highest < currentHighestHeight) {
        report.highestHeight = highest;
        this._memory.put(`${blockchain}.range.highest.height`, highest);
        this.emit(`${blockchain.toUpperCase()}_PUT_RANGE_HIGHEST_HEIGHT`, highest);
      } else if (!currentHighestHeight) {
        report.highestHeight = highest;
        this._memory.put(`${blockchain}.range.highest.height`, highest);
        report.notifyRover = true;
        this._memory.put(`${blockchain}.rover.notify`, "1");
      }

      // is the lower bound of the new request lower than a previous requests lower bound
      if (currentLowestHeight && lowest < currentLowestHeight) {
        this._memory.put(`${blockchain}.range.lowest.height`, lowest);
        report.lowestHeight = lowest;
        report.notifyRover = true;
        this._memory.put(`${blockchain}.rover.notify`, "1");
        debug(`${blockchain} rover is notified because the lowest ${lowest} is lower than the ${currentLowestHeight}`);
        //} else if (currentLowestHeight && lowest > currentLowestHeight) {
        //  report.lowestHeight = lowest
      } else if (!currentLowestHeight) {
        this._memory.put(`${blockchain}.range.lowest.height`, lowest);
        report.lowestHeight = lowest;
        report.notifyRover = true;
        this._memory.put(`${blockchain}.rover.notify`, "1");
      }
    }

    if (!missingBlocks || missingBlocks.length < 1) {
      this._memory.put(`${blockchain}.rover.notify`, "0");
      report.notifyRover = false;
    }
    // update the report to the highest and lowest heights and hashes
    if (report.highestHash) {
      debug(`openBlockRange(): setting highest hash ${report.highestHash}`);
      this._memory.put(`${blockchain}.range.highest.hash`, report.highestHash);
    }
    if (report.lowestHash) {
      debug(`setting ${blockchain} lowest boundary ${report.lowestHash}`);
      this._memory.put(`${blockchain}.range.lowest.hash`, report.lowestHash);
    }
    if (report.highestHeight) {
      debug(`openBlockRange(): setting highest height ${report.highestHeight}`);
      this._memory.put(`${blockchain}.range.highest.height`, report.highestHeight);
    }
    if (report.lowestHeight) {
      debug(`openBlockRange(): setting lowest height ${report.lowestHeight}`);
      this._memory.put(`${blockchain}.range.lowest.height`, report.lowestHeight);
    }

    return this.getObject(blockchain);
  }

  /*
   * @method getObject()
   *  - loads the latest object chainstate
   */
  getObject(blockchain) {

    if (!blockchain) {
      throw new Error(`getObject() requires blockchain argument`);
    }

    let notifyRover = false;
    const notifyRoverData = this._memory.get(`${blockchain}.rover.notify`);
    if (notifyRoverData) {
      notifyRover = notifyRoverData === "1" ? true : false;
    }

    const report = {
      highestHash: this._memory.get(`${blockchain}.range.highest.hash`),
      lowestHash: this._memory.get(`${blockchain}.range.lowest.hash`),
      highestHeight: this._memory.get(`${blockchain}.range.highest.height`),
      lowestHeight: this._memory.get(`${blockchain}.range.lowest.height`),
      notifyRover: notifyRover
    };

    return report;
  }

  /*
   * @method closeBlockRangeRequest
   *  - removes the active range requested for the given blockchain
   *  - if a segment of greater than 1 block has been found for the range the segment is removed from the requested range and a new open block range request is emitted
   */
  closeBlockRangeRequest(blockchain, roverRange, missingBlocks) {
    /*
     * RoverBlockRange {
     *   getRoverName
     *   getHighestHeight
     *   getLowestHeight
     *   getHighestHash
     *   getLowestHash
     * }
     */
    if (!blockchain) {
      throw new Error(`ERROR: closeBlockRangeRequest requires blockchain string`);
    }
    blockchain = blockchain.toLowerCase();
    if (!missingBlocks) {
      missingBlocks = [];
    }
    if (this._rovers.indexOf(blockchain) < 0) {
      throw new Error(`no rovers for blockchain ${blockchain} are connected to this collider`);
    }
    let openRequest = true;
    // if there are no blocks missing in the given range do not notify the rover + schedule any necessary pruning
    if (missingBlocks.length === 0) {
      // update the report to the highest and lowest heights and hashes
      if (roverRange.getHighestHash()) {
        this._memory.put(`${blockchain}.range.highest.hash`, roverRange.getHighestHash());
      }
      if (roverRange.getLowestHash()) {
        this._memory.put(`${blockchain}.range.lowest.hash`, roverRange.getLowestHash());
      }
      if (roverRange.getHighestHeight()) {
        this._memory.put(`${blockchain}.range.highest.height`, roverRange.getHighestHeight());
      }
      if (roverRange.getLowestHeight()) {
        this._memory.put(`${blockchain}.range.lowest.height`, roverRange.getLowestHeight());
      }
      debug(`rover returning default`);
      return {
        roverName: roverRange.getRoverName(),
        highestHeight: roverRange.getHighestHeight(),
        lowestHeight: roverRange.getLowestHeight(),
        highestHash: roverRange.getHighestHash(),
        lowestHash: roverRange.getLowestHash(),
        notifyRover: false
      };
    }

    if (missingBlocks.length === 1) {
      const lowerBlock = missingBlocks[0] - 1;
      missingBlocks.unshift(lowerBlock);
    }

    const currentRange = this.getBlockRangeRequest(blockchain);
    const lowerBounds = [currentRange.lowestHeight, roverRange.getLowestHeight(), missingBlocks[0]].filter(b => {
      if (b) {
        return b;
      }
    });
    const upperBounds = [currentRange.lowestHeight, roverRange.getLowestHeight(), missingBlocks[0]].filter(b => {
      if (b) {
        return b;
      }
    });
    lowerBounds.sort((a, b) => {
      if (a > b) {
        return 1;
      }
      if (a < b) {
        return -1;
      }
      return 0;
    });
    upperBounds.sort((a, b) => {
      if (a > b) {
        return -1;
      }
      if (a < b) {
        return 1;
      }
      return 0;
    });
    const currentHighestBound = upperBounds[0];
    const currentLowestBound = lowerBounds[0];
    const missingLowestBound = missingBlocks[0];
    const missingHighestBound = missingBlocks[missingBlocks.length - 1];
    let changeLow = 0;
    let changeHigh = 0;
    let change = 0;

    if (!currentHighestBound || !currentLowestBound) {
      throw Error(`unable to determine updates for range ${blockchain} ${currentHighestBound} - ${currentLowestBound}`);
    }

    if (missingLowestBound < currentLowestBound) {
      changeLow = missingLowestBound - currentLowestBound;
    }

    if (missingHighestBound > currentHighestBound) {
      changeHigh = missingHighestBound - currentHighestBound;
    }

    change = changeHigh + changeLow;
    if (change > 0) {
      this._logger.info(`close request window size updated ${change} blocks <- lower bound height moved ${changeLow} upper bound height moved ${changeHigh} forceNotifyRover: true`);
      return this.openBlockRangeRequest(blockchain, missingHighestBound, missingLowestBound, {
        forceNotifyRover: true,
        missingBlocks: missingBlocks
      });
    } else {
      this._logger.info(`close request window size updated ${change} blocks <- lower bound height moved ${changeLow} upper bound height moved ${changeHigh} forceNotifyRover: false`);
      return this.openBlockRangeRequest(blockchain, missingHighestBound, missingLowestBound, { missingBlocks: missingBlocks });
    }
  }

  getRangeHighestHash(blockchain) {
    if (!blockchain) {
      throw new Error(`ERROR: getRangeHighestHash requires blockchain string`);
    }
    blockchain = blockchain.toLowerCase();
    if (this._rovers.indexOf(blockchain) < 0) {
      throw new Error(`no rovers for blockchain ${blockchain} are connected to this collider`);
    }
    return this._memory.get(`${blockchain}.range.highest.hash`);
  }

  getRangeLowestHash(blockchain) {
    if (!blockchain) {
      throw new Error(`ERROR: getRangeLowestHash requires blockchain string`);
    }
    blockchain = blockchain.toLowerCase();
    if (this._rovers.indexOf(blockchain) < 0) {
      throw new Error(`no rovers for blockchain ${blockchain} are connected to this collider`);
    }
    return this._memory.get(`${blockchain}.range.lowest.hash`);
  }

  getRangeHighestHeight(blockchain) {
    if (!blockchain) {
      throw new Error(`ERROR: getRangeHighestHeight requires blockchain string`);
    }
    blockchain = blockchain.toLowerCase();
    if (this._rovers.indexOf(blockchain) < 0) {
      throw new Error(`no rovers for blockchain ${blockchain} are connected to this collider`);
    }
    return this._memory.get(`${blockchain}.range.highest.height`);
  }

  getRangeLowestHeight(blockchain) {
    if (!blockchain) {
      throw new Error(`ERROR: getRangeLowestHeight requires blockchain string`);
    }
    blockchain = blockchain.toLowerCase();
    if (this._rovers.indexOf(blockchain) < 0) {
      throw new Error(`no rovers for blockchain ${blockchain} are connected to this collider`);
    }
    return this._memory.get(`${blockchain}.range.lowest.height`);
  }

  serializeUtxo(key, utxo) {
    this._utxoCache.set(key, utxo);
    // this._utxoCache.set(`opunspent.${utxo.getTxHash()}.${utxo.getTxIndex()}`,parseInt(key.split('.')[2]))
  }

  hasUtxoByHashAndIndex(key) {
    if (!key) {
      throw new Error(`ERROR: hasUtxoByHashAndIndex requires key string`);
    }
    return this._utxoCache.has(key) && this._utxoCache.get(key) != null;
  }

  getUtxoByHashAndIndex(key) {
    if (!key) {
      throw new Error(`ERROR: getUtxoByHashAndIndex requires blockchain string`);
    }
    if (this._utxoCache.has(key)) {
      return this._utxoCache.get(key);
    } else return false;
  }

  overrideUtxoByHashAndIndex(key, utxo) {
    if (!key) {
      throw new Error(`ERROR: ovrrideUtxoByHashAndIndex requires key string`);
    }
    if (!utxo) {
      throw new Error(`ERROR: overrideUtxoByHashAndIndex requires utxo protobuf`);
    }
    // let prev = this.getUtxoByHashAndIndex(key)
    // if(prev){
    this.delUtxoByHashAndIndex(key, `1`);
    // }
    this.serializeUtxo(key, utxo);
  }

  hasAddressCache(key) {
    if (!key) {
      throw new Error(`ERROR: hasUtxoByHashAndIndex requires key string`);
    }
    return this._addressCache.has(key) && this._addressCache.get(key) != null;
  }

  getAddressCache(key) {
    return this._addressCache.get(key);
  }

  setAddressCache(key, indexes) {
    if (!key) {
      throw new Error(`ERROR: setAddressCache requires key string`);
    }
    if (!indexes) {
      throw new Error(`ERROR: setAddressCache requires indexes`);
    }
    this._addressCache.set(key, indexes);
  }

  delSimplexCache() {
    delete this._memory._memory['utxo.simplex'];
  }

  getSimplexCache() {
    return this._memory.get('utxo.simplex');
  }

  setSimplexCache(val) {
    this._memory.put('utxo.simplex', val);
  }

  setUtxoByHashAndIndex(key, utxo) {
    if (!key) {
      throw new Error(`ERROR: setUtxoByHashAndIndex requires key string`);
    }
    if (!utxo) {
      throw new Error(`ERROR: setUtxoByHashAndIndex requires utxo protobuf`);
    }

    // if (this._utxoCache.has(key)) {
    //   return true
    // }

    return this.serializeUtxo(key, utxo);
  }

  delUtxoByHashAndIndex(key, tx) {
    this._utxoCache.del(key);
    // this._utxoCache.del(tx)
    return true;
  }

  /*
   * @method getBlockRangeRequest
   * if available gets the latest open range requests
   */
  getBlockRangeRequest(blockchain) {
    if (!blockchain) {
      throw new Error(`ERROR: getBlockRangeRequest requires blockchain string`);
    }
    blockchain = blockchain.toLowerCase();
    if (this._rovers.indexOf(blockchain) < 0) {
      throw new Error(`no rovers for blockchain ${blockchain} are connected to this collider`);
    }
    const report = {
      highestHash: this.getRangeHighestHash(blockchain),
      lowestHash: this.getRangeLowestHash(blockchain),
      highestHeight: this.getRangeHighestHeight(blockchain),
      lowestHeight: this.getRangeLowestHeight(blockchain)
    };
    return report;
  }

  /*
   * @method printState()
   * print an log
   */
  printState() {

    const report = this._rovers.reduce((all, rover) => {
      all[rover] = {
        range: this.getBlockRangeRequest(rover),
        latest: {
          height: this.getLatestBlockHeight(rover),
          hash: this.getLatestBlockHash(rover)
        }
      };
      return all;
    }, {});

    report.rovers = this._rovers;
    report.work = this._memory.get(`${BC_SUPER_COLLIDER}.work`) ? this._memory.get(`${BC_SUPER_COLLIDER}.work`) : 0;
    report.state = this.getState();
    report.path = this._path;
    report.startTimestamp = this._memory.get('startTimestamp');
    report.previousTimestamp = this._memory.get('previousTimestamp') ? this._memory.get('previousTimestamp') : 0;
    report.fingerprint = this.getStateFingerprint();
    this._logger.info(JSON.stringify(report, null, 2));
  }

  printMultiverse() {

    const firstRow = [];
    const secondRow = [''];

    const report = this._rovers.reduce((all, rover) => {
      const roverUp = `[${rover.toUpperCase()}: ${this.getBlockchainState(rover)}]`;
      const hash = this.getLatestBlockHash(rover);
      const height = this.getLatestBlockHeight(rover);
      let secondRowLine = "";
      let firstRowLine = roverUp;

      if (hash && height) {
        secondRowLine = `   ${rover}:${height}:${hash}`;
        for (let i = 0; i < Math.abs(secondRowLine.length - roverUp.length); i++) {
          firstRowLine = firstRowLine + ' ';
        }
      } else {
        secondRowLine = `   ${rover}: pending...`;
      }

      secondRow.push(secondRowLine);
      return all;
    }, {});
    // add an empty row on the top and bottom
    secondRow.unshift("");
    secondRow.push("");
    secondRow.push(`   MINER DASHBOARD (HTTP): "http://localhost:${UI_PORT}/#/"`);
    secondRow.push(`   SETUP GUIDE: "https://docs.blockcollider.org"`);
    secondRow.push("");

    this._logger.info(secondRow.join('\n'));
  }
}
exports.ChainState = ChainState;