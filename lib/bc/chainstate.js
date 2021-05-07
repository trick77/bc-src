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
const debugLowest = require('debug')('bcnode:bc:chainstatelowest');
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
    this._persistence = opts.persistence;
    this._memory = new MemoryMap(path, opts);
    this._logger.info(`connection opened with rovers ${this._rovers} with storage at ${path}`);
    this._utxoCache = new LRUCache({
      max: 10000
    });
    this._addressCache = new LRUCache({
      max: 10000
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

  async get(key) {
    return this._persistence.get(key);
  }

  async close(removeDiskData = false) {
    this.emit('PUT_STATE_CLOSE');
    return new Promise(async (resolve, reject) => {
      try {
        const currentState = await this._persistence.get('state');
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
  async getBlockchainState(blockchain) {
    if (!blockchain) {
      throw new Error(`ERROR: getBlockchainState requires blockchain string (blockchaint)`);
    }
    blockchain = blockchain.toLowerCase();
    if (this._rovers.indexOf(blockchain) < 0) {
      throw new Error(`no "${blockchain}" rovers are streaming to this collider`);
    }

    const rangeHighestHeight = await this._persistence.get(`${blockchain}.range.highest.height`);
    const rangeLowestHeight = await this._persistence.get(`${blockchain}.range.lowest.height`);

    // if latest block is not defined false
    const latestBlockHeight = await this._persistence.get(`${blockchain}.block.latest.height`);
    const latestBlockHash = await this._persistence.get(`${blockchain}.block.latest.hash`);
    const currentState = await this._persistence.get(`${blockchain}.state`);
    const requiredMetrics = all(a => a !== undefined && a !== null && a !== false, [currentState, rangeHighestHeight, rangeLowestHeight, latestBlockHeight, latestBlockHash]);
    if (requiredMetrics) {
      const range = rangeHighestHeight - rangeLowestHeight;
      const optimum = Math.abs(range * 2) + rangeHighestHeight;

      // OVERLINE BLOCKCHAIN STATES
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
          await this._persistence.put(`${blockchain}.state`, 'READY');
          this.emit(`${blockchain.toUpperCase()}_PUT_STATE`, 'READY');
        }
        return 'READY';

        /*
         * STATE: SYNC
         * latest block height is below range requested
         */
      } else if (latestBlockHeight < rangeHighestHeight && rangeHighestHeight - rangeLowestHeight > 4) {
        if (currentState !== 'SYNC') {
          await this._persistence.put(`${blockchain}.state`, 'SYNC');
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
  async getStateFingerprint(superCollider = BC_SUPER_COLLIDER) {
    const c = await this._persistence.get(`${superCollider}.work`);
    let synced = true;
    const str = this._rovers.reduce(async (all, rover) => {
      const syncStatus = this.getSyncStatus(rover);
      const h = await this._persistence.get(`${rover}.block.latest.height`);
      const hash = await this._persistence.get(`${rover}.block.latest.hash`);
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
  async getState() {
    const report = this._rovers.reduce(async (all, blockchain) => {
      all[blockchain] = await this.getBlockchainState(blockchain);
      return all;
    }, {});

    const standard = report[this._rovers[0]];

    const allStatesReport = Object.keys(report).every(chain => {
      return report[chain] === standard;
    });

    const states = Object.keys(report).reduce(async (all, chain) => {
      all.push(report[chain]);
      return all;
    }, []);

    const currentState = await this._persistence.get('state');

    if (allStatesReport && standard !== currentState) {
      this._memory.put('state', standard);
      this.emit(`PUT_STATE`, standard);
    } else {
      if (states.indexOf('SYNC') < 0 && states.indexOf('RESTART') < 0 && states.indexOf('WAIT') < 0) {
        if (currentState !== 'READY') {
          await this._persistence.put('state', 'READY');
          this.emit(`PUT_STATE`, 'READY');
        }
      } else {
        // Select the most common state
        const counts = Object.keys(report).reduce(async (all, item) => {
          if (!all[item]) {
            all[item] = 1;
          } else {
            all[item]++;
          }
          return all;
        }, {});

        const highest = Object.keys(counts).reduce(async (all, chain) => {
          if (!all) {
            all = { chain: chain, count: counts[chain] };
          } else if (counts[chain] > all.count) {
            all = { chain: chain, count: counts[chain] };
          }
          return all;
        }, false);

        if (currentState !== report[highest.chain]) {
          await this._persistence.put('state', report[highest.chain]);
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
  async putLatestBlock(blockchain, height, hash, force = false) {
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
    return;
  }

  /*
   * @method getSyncStatus
   * the sync status of the
   */
  async getSyncStatus(blockchain) {
    if (!blockchain) {
      throw new Error(`ERROR: getSyncStatus requires blockchain string (blockchain)`);
    }
    blockchain = blockchain.toLowerCase();
    const status = await this._persistence.get(`${blockchain}.status`);
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
  async putSyncStatus(blockchain, status = false) {
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
    await this._persistence.put(`${blockchain}.status`, numeralStatus);
    return status;
  }

  /*
   * @method getLatestBlockHeight
   */
  async getLatestBlockHeight(blockchain) {
    if (!blockchain) {
      throw new Error('getLatestBlockHeight requires blockchain to request');
    }
    return this._persistence.get(`${blockchain}.block.latest.height`);
  }

  /*
   * @method getLatestBlockHash
   */
  async getLatestBlockHash(blockchain) {
    return this._persistence.get(`${blockchain}.block.latest.hash`);
  }

  /*
   * @method openBlockRangeRequest
   * for the given blockchain requests a range of blocks between and including heights
   * if a reuqest is already open the range heights and hashes are updated on both sides of the request window
   * "bc", [highestBlockHeight, lowestBlockHeight]
   */
  async openBlockRangeRequest(blockchain, highest, lowest, opts = {}) {
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
      await this._persistence.put(`${blockchain}.rover.notify`, "0");
    }

    const missingBlocks = opts.missingBlocks;
    const lowestHash = opts.lowestHash ? opts.lowestHash : await this.getRangeLowestHash(blockchain);
    const highestHash = opts.highestHash ? opts.highestHash : await this.getRangeHighestHash(blockchain);
    report.lowestHash = lowestHash;
    report.highestHash = highestHash;
    // TODO: Candidate to delete
    this.emit(`${blockchain.toUpperCase()}_OPEN_BLOCK_RANGE`, [highest, lowest]);
    const rangeSizeLimit = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[blockchain]) * 100;
    const requestedRange = highest - lowest;
    if (BigInt(highest - lowest) > BigInt(rangeSizeLimit) && blockchain !== BC_SUPER_COLLIDER) {
      this._logger.info(` requested range ${requestedRange} out of greater than ${rangeSizeLimit} for ${blockchain} rover`);
    } else if (requestedRange < 1) {
      //this._logger.warn(`open block range must be a vector <- highest !== lowest`)
      debug(`open block range must be a vector <- highest !== lowest`);
      return report;
    }
    const c = await this._persistence.get(`${blockchain}.range.highest.height`);

    // if range.highest.height has not been saved, store in chainstate
    if (!c) {
      await this._persistence.put(`${blockchain}.range.highest.height`, highest);
      await this._persistence.put(`${blockchain}.range.lowest.height`, lowest);
      debugLowest(`1.${blockchain}.range.lowest.height set to ${lowest}`);
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
            await this._persistence.put(`${blockchain}.rover.notify`, "1");
          }
        }
      }

      if (highestHash) {
        await this._persistence.put(`${blockchain}.range.highest.hash`, highestHash);
        report.highestHash = highestHash;
        this.emit(`${blockchain.toUpperCase()}.PUT_RANGE_HIGHEST_HASH`, highestHash);
      }

      if (lowestHash) {
        await this._persistence.put(`${blockchain}.range.lowest.hash`, lowestHash);
        report.lowestHash = lowestHash;
        this.emit(`${blockchain.toUpperCase()}.PUT_RANGE_LOWEST_HASH`, lowestHash);
      }
    } else {
      const currentLatestHeight = await this.getLatestBlockHeight(blockchain);
      const currentHighestHeight = await this.getRangeHighestHeight(blockchain);
      let currentLowestHeight = await this.getRangeLowestHeight(blockchain);
      // set the default to the current highest height
      report.highestHeight = currentHighestHeight;
      report.lowestHeight = currentLowestHeight;

      const mg = await this._persistence.get(`${blockchain}.range.highest.hash`);
      if (highestHash && mg) {
        // interesting rare case <- height is equal but the hash does not match representing a conflicting branch
        const currentHighestHash = await this._persistence.get(`${blockchain}.range.highest.hash`);
        if (highest === currentHighestHeight && currentHighestHash !== highestHash) {
          this._logger.warn(`multiverse conflict case discovered at block height ${highest} original hash: ${currentHighestHash} new: ${highestHash}`);
          await this._persistence.put(`${blockchain}.range.highest.hash`, highestHash);
          report.highestHash = highestHash;
        } else if (highest > currentHighestHeight && highestHash) {
          await this._persistence.put(`${blockchain}.range.highest.hash`, highestHash);
          report.highestHash = highestHash;
          this.emit(`${blockchain.toUpperCase()}.PUT_RANGE_HIGHEST_HASH`, highestHash);
        }
      }

      const lhh = await this._persistence.get(`${blockchain}.range.lowest.hash`);

      if (lowestHash && lhh) {
        // interesting rare case <- height is equal but the hash does not match representing a conflicting branch
        const currentLowestHash = await this._persistence.get(`${blockchain}.range.lowest.hash`);
        if (lowest === currentLowestHeight && currentLowestHash !== lowestHash) {
          this._logger.warn(`multiverse change case discovered at block height ${lowest} original hash: ${currentLowestHash} new: ${lowestHash}`);
          report.lowestHash = lowestHash;
          await this._persistence.put(`${blockchain}.range.lowest.hash`, lowestHash);
        } else if (lowest < currentLowestHeight && lowestHash) {
          report.lowestHash = lowestHash;
          await this._persistence.put(`${blockchain}.range.lowest.hash`, lowestHash);
          this.emit(`${blockchain.toUpperCase()}.PUT_RANGE_LOWEST_HASH`, lowestHash);
        }
      }

      // is the upper bound of the new request higher than a previous requests upper bound
      if (currentHighestHeight && highest > currentHighestHeight + 1) {
        await this._persistence.put(`${blockchain}.range.highest.height`, highest);
        report.highestHeight = highest;
        this.emit(`${blockchain.toUpperCase()}_PUT_RANGE_HIGHEST_HEIGHT`, highest);
        debug(`${blockchain} rover is notified because the highest of the range requested ${highest} block is > current highest ${currentHighestHeight} + 1`);
        report.notifyRover = true;
        await this._persistence.put(`${blockchain}.rover.notify`, "1");
        // moving lowest to latest height
        if (currentLatestHeight && currentLatestHeight > lowest) {
          debug(`moved lowest height ${lowest} frame to latest height ${currentLatestHeight}`);
          lowest = currentLatestHeight;
          await this._persistence.put(`${blockchain}.range.lowest.height`, lowest);
          debugLowest(`2.${blockchain}.range.lowest.height set to ${lowest}`);
          report.lowestHeight = currentLatestHeight;
        }
      } else if (currentHighestHeight && highest < currentHighestHeight) {
        report.highestHeight = highest;
        await this._persistence.put(`${blockchain}.range.highest.height`, highest);
        this.emit(`${blockchain.toUpperCase()}_PUT_RANGE_HIGHEST_HEIGHT`, highest);
      } else if (!currentHighestHeight) {
        report.highestHeight = highest;
        await this._persistence.put(`${blockchain}.range.highest.height`, highest);
        report.notifyRover = true;
        await this._persistence.put(`${blockchain}.rover.notify`, "1");
      }

      // is the lower bound of the new request lower than a previous requests lower bound
      if (currentLowestHeight && lowest < currentLowestHeight) {
        await this._persistence.put(`${blockchain}.range.lowest.height`, lowest);
        debugLowest(`3.${blockchain}.range.lowest.height set to ${lowest}`);
        report.lowestHeight = lowest;
        report.notifyRover = true;
        await this._persistence.put(`${blockchain}.rover.notify`, "1");
        debug(`${blockchain} rover is notified because the lowest ${lowest} is lower than the ${currentLowestHeight}`);
        //} else if (currentLowestHeight && lowest > currentLowestHeight) {
        //  report.lowestHeight = lowest
      } else if (!currentLowestHeight) {
        await this._persistence.put(`${blockchain}.range.lowest.height`, lowest);
        debugLowest(`4.${blockchain}.range.lowest.height set to ${lowest}`);
        report.lowestHeight = lowest;
        report.notifyRover = true;
        await this._persistence.put(`${blockchain}.rover.notify`, "1");
      }
    }

    if (!missingBlocks || missingBlocks.length < 1) {
      await this._persistence.put(`${blockchain}.rover.notify`, "0");
      report.notifyRover = false;
    }
    // update the report to the highest and lowest heights and hashes
    if (report.highestHash) {
      debug(`openBlockRange(): setting highest hash ${report.highestHash}`);
      await this._persistence.put(`${blockchain}.range.highest.hash`, report.highestHash);
    }
    if (report.lowestHash) {
      debug(`setting ${blockchain} lowest boundary ${report.lowestHash}`);
      await this._persistence.put(`${blockchain}.range.lowest.hash`, report.lowestHash);
    }
    if (report.highestHeight) {
      debug(`openBlockRange(): setting highest height ${report.highestHeight}`);
      await this._persistence.put(`${blockchain}.range.highest.height`, report.highestHeight);
    }
    if (report.lowestHeight) {
      debug(`openBlockRange(): setting lowest height ${report.lowestHeight}`);
      await this._persistence.put(`${blockchain}.range.lowest.height`, report.lowestHeight);
      debugLowest(`5.${blockchain}.range.lowest.height set to ${report.lowestHeight}`);
    }

    return this.getObject(blockchain);
  }

  /*
   * @method getObject()
   *  - loads the latest object chainstate
   */
  async getObject(blockchain) {

    if (!blockchain) {
      throw new Error(`getObject() requires blockchain argument`);
    }

    let notifyRover = false;
    const notifyRoverData = await this._persistence.get(`${blockchain}.rover.notify`);
    if (notifyRoverData) {
      notifyRover = notifyRoverData === "1" ? true : false;
    }

    const report = {
      highestHash: await this._persistence.get(`${blockchain}.range.highest.hash`),
      lowestHash: await this._persistence.get(`${blockchain}.range.lowest.hash`),
      highestHeight: await this._persistence.get(`${blockchain}.range.highest.height`),
      lowestHeight: await this._persistence.get(`${blockchain}.range.lowest.height`),
      notifyRover: notifyRover
    };

    return report;
  }

  /*
   * @method closeBlockRangeRequest
   *  - removes the active range requested for the given blockchain
   *  - if a segment of greater than 1 block has been found for the range the segment is removed from the requested range and a new open block range request is emitted
   */
  async closeBlockRangeRequest(blockchain, roverRange, missingBlocks) {
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
        await this._persistence.put(`${blockchain}.range.highest.hash`, roverRange.getHighestHash());
      }
      if (roverRange.getLowestHash()) {
        await this._persistence.put(`${blockchain}.range.lowest.hash`, roverRange.getLowestHash());
      }
      if (roverRange.getHighestHeight()) {
        await this._persistence.put(`${blockchain}.range.highest.height`, roverRange.getHighestHeight());
      }
      if (roverRange.getLowestHeight()) {
        await this._persistence.put(`${blockchain}.range.lowest.height`, roverRange.getLowestHeight());
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

    const currentRange = await this.getBlockRangeRequest(blockchain);
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

  async getRangeHighestHash(blockchain) {
    if (!blockchain) {
      throw new Error(`ERROR: getRangeHighestHash requires blockchain string`);
    }
    blockchain = blockchain.toLowerCase();
    if (this._rovers.indexOf(blockchain) < 0) {
      throw new Error(`no rovers for blockchain ${blockchain} are connected to this collider`);
    }
    return this._persistence.get(`${blockchain}.range.highest.hash`);
  }

  async getRangeLowestHash(blockchain) {
    if (!blockchain) {
      throw new Error(`ERROR: getRangeLowestHash requires blockchain string`);
    }
    blockchain = blockchain.toLowerCase();
    if (this._rovers.indexOf(blockchain) < 0) {
      throw new Error(`no rovers for blockchain ${blockchain} are connected to this collider`);
    }
    return this._persistence.get(`${blockchain}.range.lowest.hash`);
  }

  async getRangeHighestHeight(blockchain) {
    if (!blockchain) {
      throw new Error(`ERROR: getRangeHighestHeight requires blockchain string`);
    }
    blockchain = blockchain.toLowerCase();
    if (this._rovers.indexOf(blockchain) < 0) {
      throw new Error(`no rovers for blockchain ${blockchain} are connected to this collider`);
    }
    return this._persistence.get(`${blockchain}.range.highest.height`);
  }

  async getRangeLowestHeight(blockchain) {
    if (!blockchain) {
      throw new Error(`ERROR: getRangeLowestHeight requires blockchain string`);
    }
    blockchain = blockchain.toLowerCase();
    if (this._rovers.indexOf(blockchain) < 0) {
      throw new Error(`no rovers for blockchain ${blockchain} are connected to this collider`);
    }
    return this._persistence.get(`${blockchain}.range.lowest.height`);
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

  async delSimplexCache() {
    delete this._persistence._memory['utxo.simplex'];
  }

  async getSimplexCache() {
    return this._persistence.get('utxo.simplex');
  }

  async setSimplexCache(val) {
    await this._persistence.put('utxo.simplex', val);
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
  async getBlockRangeRequest(blockchain) {
    if (!blockchain) {
      throw new Error(`ERROR: getBlockRangeRequest requires blockchain string`);
    }
    blockchain = blockchain.toLowerCase();
    if (this._rovers.indexOf(blockchain) < 0) {
      throw new Error(`no rovers for blockchain ${blockchain} are connected to this collider`);
    }
    const report = {
      highestHash: await this.getRangeHighestHash(blockchain),
      lowestHash: await this.getRangeLowestHash(blockchain),
      highestHeight: await this.getRangeHighestHeight(blockchain),
      lowestHeight: await this.getRangeLowestHeight(blockchain)
    };
    return report;
  }

  /*
   * @method printState()
   * print an log
   */
  async printState() {

    const report = this._rovers.reduce(async (all, rover) => {
      all[rover] = {
        range: await this.getBlockRangeRequest(rover),
        latest: {
          height: await this.getLatestBlockHeight(rover),
          hash: await this.getLatestBlockHash(rover)
        }
      };
      return all;
    }, {});

    report.rovers = this._rovers;
    report.work = await this._persistence.get(`${BC_SUPER_COLLIDER}.work`);
    report.state = this.getState();
    report.path = this._path;
    report.startTimestamp = await this._persistence.get('startTimestamp');
    report.previousTimestamp = await this._persistence.get('previousTimestamp');
    report.fingerprint = await this.getStateFingerprint();
    this._logger.info(JSON.stringify(report, null, 2));
  }

  async printMultiverse() {

    const firstRow = [];
    const secondRow = [''];

    const report = this._rovers.reduce(async (all, rover) => {
      const roverUp = `[${rover.toUpperCase()}: ${this.getBlockchainState(rover)}]`;
      const hash = await this.getLatestBlockHash(rover);
      const height = await this.getLatestBlockHeight(rover);
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
    secondRow.push(`   SETUP GUIDE: "https://docs.overline.network"`);
    secondRow.push("");

    this._logger.info(secondRow.join('\n'));
  }
}
exports.ChainState = ChainState;