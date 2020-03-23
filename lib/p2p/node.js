'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
// TODO: Remove ESLINT disable

/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
/* global $Values */
const { inspect } = require('util');

const Url = require('url');
const queue = require('async/queue');
const bufferSplit = require('buffer-split');

const LRUCache = require('lru-cache');
const BN = require('bn.js');
const fkill = require('fkill');
const debug = require('debug')('bcnode:p2p:node');
const framer = require('frame-stream');
const backpressureWriteStream = require('stream-write');
const zlib = require('zlib');
const gunzip = zlib.createGunzip();
const logging = require('../logger');
const rovers = require('../rover/manager').rovers;

const { BcBlock, Transaction } = require('../protos/core_pb');
const { RoverMessage } = require('../protos/rover_pb');
const { parseBoolean } = require('../utils/config');
const { InitialPeer, BcBlocks } = require('../protos/p2p_pb');
const { Multiverse } = require('../bc/multiverse');
const Discovery = require('./discovery');
const { getGenesisBlock } = require('../bc/genesis');
const {
  isValidBlock,
  validateSequenceTotalDistance,
  validateSequenceDifficulty,
  validateRequireMountBlock,
  validateRoveredSequences,
  validateBlockSequence,
  validateCoinbase,
  childrenHeightSum,
  childrenHighestBlock,
  childrenLowestBlock
} = require('../bc/validation');
const { networks } = require('../config/networks');

const _MAX_FRAME_SIZE = 9 * 1024 * 1024; // 9MB
const FRAMING_OPTS = {
  lengthSize: 4,
  getLength: function (buffer) {
    return buffer.readUInt32BE(0);
  },
  maxSize: _MAX_FRAME_SIZE
};
const PEER_QUARANTINE = [];
const PEER_RECORD = {};
const PEER_BLACKLIST = process.env.PEER_BLACKLIST && process.env.PEER_BLACKLIST.indexOf('.') > -1 ? process.env.PEER_BLACKLIST.split(',') : [];
const SEEN_BLOCKS_MEMORY = {};
const BC_NETWORK = process.env.BC_NETWORK || 'main';
const BC_SUPER_COLLIDER = process.env.BC_SUPER_COLLIDER ? process.env.BC_SUPER_COLLIDER.toLowerCase() : 'bc';
const { quorum, maximumWaypoints } = networks[BC_NETWORK];
const { contains, find, isEmpty, max, min, merge, values, last } = require('ramda');
const numCPUs = Number(require('os').cpus().length);
const loadBasedPeerExpiration = 25000 + Math.floor(30000 / numCPUs);
/* OVERLINE
 * export const DISABLE_IPH_TEST = parseBoolean(process.env.DISABLE_IPH_TEST) // Used only on testnets, breaks consensus if enabled
 */
const DISABLE_IPH_TEST = exports.DISABLE_IPH_TEST = true;
const BC_USER_QUORUM = exports.BC_USER_QUORUM = parseInt(process.env.BC_USER_QUORUM, 10) || quorum;
const MAX_HEADER_RANGE = exports.MAX_HEADER_RANGE = Number(process.env.MAX_HEADER_RANGE) || 1000;
const BC_IPHT_MINIMUM = exports.BC_IPHT_MINIMUM = isNaN(process.env.BC_IPHT_MINIMUM) ? BC_USER_QUORUM : Number(process.env.BC_IPHT_MINIMUM);
const MAX_DATA_RANGE = exports.MAX_DATA_RANGE = Number(process.env.MAX_DATA_RANGE) || 6;
const BC_MAX_TX_RANGE = exports.BC_MAX_TX_RANGE = Number(process.env.BC_MAX_TX_RANGE) || 1000;
//export const MAX_DATA_RANGE = Number(process.env.MAX_DATA_RANGE) || 50
const BC_LINKED_SYNC = exports.BC_LINKED_SYNC = process.env.BC_LINKED_SYNC === 'true';
const BC_PEER_HEADER_SYNC_EXPIRE = exports.BC_PEER_HEADER_SYNC_EXPIRE = Number(process.env.BC_PEER_HEADER_SYNC_EXPIRE) || loadBasedPeerExpiration; // Peer must return a header request before time elapsed (milliseconds)
const BC_MAX_CONNECTIONS = exports.BC_MAX_CONNECTIONS = process.env.BC_MAX_CONNECTIONS || maximumWaypoints;
const BC_MAX_CONNECTION_REQUESTS = exports.BC_MAX_CONNECTION_REQUESTS = process.env.BC_MAX_CONNECTION_REQUESTS || 100;
const BC_MAX_REQUEST_PEERS = exports.BC_MAX_REQUEST_PEERS = process.env.BC_MAX_REQUEST_PEERS || 2;
const MIN_HEALTH_NET = process.env.MIN_HEALTH_NET === 'true';
const STRICT_SEND_BC = process.env.STRICT_SEND_BC || true;
const PEER_DATA_SYNC_EXPIRE = 32661; // Peer must return a block / data / network request before time elapsed (milliseconds)
let BC_BIND_PEER = process.env.BC_BIND_PEER !== 'false' ? process.env.BC_BIND_PEER : false;

const { MESSAGES, MSG_SEPARATOR } = require('./protocol');
const { encodeTypeAndData, encodeMessageToWire } = require('./codec');

const addressToHost = exports.addressToHost = addr => {
  if (!addr) {
    return null;
  }
  let address = addr;
  address = address.replace("::ffff:", "");
  if (address.indexOf(":") > -1) {
    address = address.split(":")[0];
  }

  return address;
};

/* const FULL_NODE_MSGS = [
     MESSAGES.GET_HEADERS,
     MESSAGES.GET_HEADER,
     MESSAGES.GET_BLOCKS,
     MESSAGES.GET_BLOCK,
     MESSAGES.GET_DATA,
     MESSAGES.GET_TXS,
     MESSAGES.HEADERS,
     MESSAGES.HEADER,
     MESSAGES.BLOCKS,
     MESSAGES.BLOCK,
     MESSAGES.DATA,
     MESSAGES.TXS,
     MESSAGES.TX
   ]
*/

class PeerNode {
  // eslint-disable-line no-undef

  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  constructor(engine) {
    debug("--- NETWORK CONFIG --- \n%O", networks[BC_NETWORK]);
    this._engine = engine;
    this._syncComplete = true;
    this._knownHashes = [];
    this._txRateLimiter = {};
    this._requestRegistry = {};
    this._connectionRegistry = {};
    this._multiverse = new Multiverse(engine.persistence, Object.keys(rovers), engine.chainState, engine); /// !important this is a (nonselective) multiverse
    this._logger = logging.getLogger(__filename);
    this._blockRangeUpperBound = false;
    this._blockRangeLowerBound = false;
    this._discovery = {
      givenHostName: false
    };
    this._greetingRegister = {};
    this._dataRequestRegister = LRUCache({
      max: 3000
    });
    this._knownBlocks = LRUCache({
      max: 1000
    });
    this._knownBlockSegments = LRUCache({
      max: 5000
    });
    this._seededPeers = LRUCache({
      max: 1000
    });
    this._noDoubleSent = LRUCache({
      max: 500
    });

    this._logger.info(`node p2p interface starting with expiration ${BC_PEER_HEADER_SYNC_EXPIRE}`);

    setInterval(() => {
      PEER_QUARANTINE.shift();
    }, 93000);

    this._queue = queue((task, cb) => {
      if (task.keys) {
        this._engine.persistence.getBulk(task.keys).then(res => {
          cb(null, res);
        }).catch(err => {
          cb(err);
        });
      } else {
        this._engine.persistence.get(task).then(res => {
          cb(null, res);
        }).catch(err => {
          console.trace(err);
          cb(err);
        });
      }
    });

    async function statusInterval() {
      this._logger.info('waypoints active: ' + this._discovery.connected + ' passive: ' + PEER_QUARANTINE.length);
      this._engine._emitter.emit('peerCount', this._discovery.connected);
      if (this._discovery.connected < BC_USER_QUORUM && MIN_HEALTH_NET !== true) {
        try {
          debug('local client restarting IPH and IPD tests');
          await this._engine.persistence.put('bc.sync.initialpeerdata', 'pending');
          await this._engine.persistence.put('bc.sync.initialpeerheader', 'pending');
          await this._engine.persistence.put('bc.sync.initialpeernum', 0);
          await this._engine.persistence.put('bc.sync.initialpeerevents', []);
          //await this._engine.persistence.put('bc.sync.initialpeer', new InitialPeer())
          await this._engine.persistence.put('bc.dht.quorum', 0);
        } catch (err) {
          console.trace(err);
          this._logger.error(err);
        }
      }
    }

    // monitor peer connection status and resync peer evauations if quorum is lost
    setInterval(statusInterval.bind(this), 30900);
  } // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef


  get multiverse() {
    return this._multiverse;
  }

  clearTxRateLimiter() {
    const secondEnd = Math.floor(new Date() / 1000) - 2;
    const secondStart = Math.floor(new Date() / 1000) - 60;
    for (let i = secondStart; i < secondEnd; i++) {
      if (this._txRateLimiter[i]) {
        delete this._txRateLimiter[i];
      }
    }
  }

  set multiverse(multiverse) {
    this._multiverse = multiverse;
  }

  /*
   * sends the bounds of the block range ready for evaluation
   */
  setBlockRange(nextRange, nextRangeHashes) {
    if (this._blockRangeUpperBound && this._blockRangeLowerBound && this._blockRangeLowerBound.hash && this._blockRangeUpperBound.hash) {
      // if a previous range should be evaluated on disk report it to the controller
      const payload = new RoverMessage.RoverBlockRange([BC_SUPER_COLLIDER, this._blockRangeUpperBound.height, this._blockRangeLowerBound.height, this._blockRangeUpperBound.hash, this._blockRangeLowerBound.hash]);
      this._engine._emitter.emit('roverBlockRange', payload);
      this._blockRangeUpperBound = null;
      this._blockRangeLowerBound = null;
    }
    if (nextRange && nextRange.length > 1) {
      this._blockRangeUpperBound = { height: nextRange[0], hash: false };
      this._blockRangeLowerBound = { height: nextRange[1], hash: false };
      if (nextRangeHashes) {
        this._blockRangeUpperBound.hash = nextRangeHashes[0];
        this._blockRangeLowerBound.hash = nextRangeHashes[1];
      }
    }
  }

  async getLiteMultiverse(latest) {
    if (latest.getHeight() < 4) {
      return Promise.resolve([latest]);
    }
    const query = ['bc.block.' + (latest.getHeight() - 1), 'bc.block.' + (latest.getHeight() - 2)];

    try {
      const set = await this._engine.persistence.getBulk(query);
      // if it is a valid set of multiple options send it otherwise resolve with the latest
      if (set !== undefined && set !== false && set.length > 0) {
        set.unshift(latest);
        return Promise.resolve(set.sort((a, b) => {
          if (new BN(a.getHeight()).gt(new BN(b.getHeight())) === true) {
            return -1;
          }
          if (new BN(a.getHeight()).lt(new BN(b.getHeight())) === true) {
            return 1;
          }
          return 0;
        }));
      }
      return Promise.resolve([latest]);
    } catch (err) {
      this._logger.error(err);
      this._logger.warn('multiverse not set on disk');
      return Promise.resolve([latest]);
    }
  }

  async safeQSend(address, msg, fallOver, dontUpdateCurrentPeer = false) {

    if (!address || address.indexOf(':') < 0) {
      throw new Error(`address not provided`);
    }

    let sent = false;

    if (sent && sent.success) {
      return Promise.resolve({ success: true });
    }

    let conn = fallOver;
    if (!conn) {
      conn = find(({ remoteAddress, remotePort }) => `${remoteAddress}:${remotePort}` === address, this._discovery.connections);
    }

    if (!conn) {
      address = addressToHost(address);
      this._logger.info(`unable to find ${address} in current peer table...searching ${address} by ip`);
      conn = find(({ remoteAddress }) => `${addressToHost(remoteAddress)}` === address, this._discovery.connections);
      if (conn && conn !== null && !dontUpdateCurrentPeer) {
        const currentPeer = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        if (currentPeer) {
          const cpAddr = currentPeer.getAddress();
          if (cpAddr === address) {
            currentPeer.setAddress(address);
            await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
            this._logger.info(`upgraded send message to managed connection: ${address}`);
          }
        }
      }
    }

    if (!conn && fallOver) {
      conn = fallOver;
    }

    if (!conn) {
      //debug(`failed to find connection for ${address}`)
      return Promise.resolve({ sucess: false, message: `requested connection ${address} is unavailable` });
    } else {
      //debug(`found connection by ip for ${address}`)
    }

    return this.qsend(conn, msg);
  }

  async rsend(address, msg, fallOver, dontUpdateCurrentPeer = false) {

    return new Promise(async (resolve, reject) => {
      let retry = true;
      let rs = 0;
      const qTimeout = setTimeout(() => {
        retry = false;
        reject({ success: false, msg: `request timed out ${address}` });
      }, 2010);

      const cycle = async () => {
        rs++;
        debug(`rsend(): request attempt ${rs} to ${address}`);
        const fall = rs % 2 === 1 ? fallOver : false;
        const sent = await this.safeQSend(address, msg, fall, dontUpdateCurrentPeer);
        // console.log({sent})
        if (sent && sent.success) {
          clearTimeout(qTimeout);
          return sent;
        } else if (retry) {
          setTimeout(() => {
            return cycle();
          }, 200);
        }
      };
      const startCycle = await cycle();
      return resolve(startCycle);
    });
  }

  qsend(conn, msg) {
    return new Promise((resolve, reject) => {
      const wireData = encodeMessageToWire(msg);
      const address = `${conn.remoteAddress}:${conn.remotePort}`;
      try {
        debug(`qsend(): about to write ${wireData.length}b`);
        backpressureWriteStream(conn, wireData, function (err, open) {
          if (err) {
            debug(`qsend(): error while writing data ${err.message}`);
            return resolve({
              address,
              success: false,
              message: err.message
            });
          }
          debug(`qsend(): wrote ${wireData.length}b`);
          return resolve({
            address,
            success: true,
            message: 'success'
          });
        });
      } catch (err) {
        if (err) {
          return resolve({
            address,
            success: false,
            message: err.message
          });
        }
        return resolve({
          address,
          success: false,
          message: 'connection lost'
        });
      }
    });
  }

  /*
   * resetPeerEvaluations
   */
  async resetPeerEvaluations() {
    debug('reseting peer evaluations');
    await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerheader`, 'pending');
    await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerdata`, 'pending');
    await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeernum`, 0);
    await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerevents`, []);
    await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, new InitialPeer());
    return Promise.resolve(true);
  }

  /*
   * reset block (including transaction indexes) from block height height
   */
  async resetBlocksFrom(height) {
    if (height > 2) {
      for (let i = 2; i < height; i++) {
        const block = await this._engine.persistence.getBlockByHeight(i);
        if (block !== null) {
          await this._engine.persistence.delBlock(block.getHash());
        }
      }
    }
    return true;
  }

  /*
   * processPeerEvaluations
   * From peristence determines if matches exist and begins the header sync loop if so this happens
   */
  async processPeerEvaluations() {
    try {
      // loads events from disk, prevents multiple instantiations
      debug('running processPeerEvaluations');
      let events = await this._engine.persistence.get('bc.sync.initialpeerevents');
      if (events === null) {
        events = [];
      }
      // if a peer has just been rejected this peer will be removed from events
      let roverSyncComplete = this._engine.rovers.areRoversSynced();
      roverSyncComplete = true; // TODO: Remove override after P2P sync complete
      if (!roverSyncComplete && !DISABLE_IPH_TEST) {
        debug('process peer evaluation requested, rover sync not complete');
        return false;
      }
      // get the current synchronization peer context for headers and data
      let initialPeer = await this._engine.persistence.get('bc.sync.initialpeer');
      if (events === null || events.length === 0) {
        debug(`events not available`);
        return false;
      }
      if (initialPeer === null) {
        initialPeer = new InitialPeer();
      }
      // get the status of the data evaluation
      const ipd = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeerdata`);
      const iph = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeerheader`);
      debug(`processPeerEvaluation running ipd: ${ipd} `);
      // if the initial peer is present, remove the peer from the events log
      if (!isEmpty(initialPeer.getAddress()) && ipd !== 'running' && iph !== 'running') {
        debug(`removing peer ${initialPeer.getAddress()}`);
        events = events.reduce((all, e) => {
          if (addressToHost(e.address) !== initialPeer.getAddress()) {
            all.push(e);
          }
          return all;
        }, []);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerevents`, events);
        // delete all headers range
        const latestBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
        if (!latestBlock) {
          this._logger.warn(`Couldn't get 'bc.block.latest' in processPeerEvaluations`);
          return;
        }
        const latestHeight = latestBlock.getHeight();
        debug(`deleting header blocks from initial peer resetting initial peer evaluations`);
        if (latestHeight > 2) {
          for (let i = 2; i < latestHeight; i++) {
            debug(`purging block bc.block.${i}`);
            await this._engine.persistence.del(`bc.block.${i}`);
          }
        }
        // reset IPH back to pending
        await this._engine.persistence.put('bc.sync.initialpeerdata', 'pending');
        // switch IPH from complete to running
        await this._engine.persistence.put('bc.sync.initialpeerheader', 'running');
        // ipd stage is running, check if the peer has not responded in time
      } else if (ipd === 'running' && Number(new Date()) > parseInt(initialPeer.getExpires(), 10)) {
        // this means the given peer has expired
        debug(`peer has expired and events are being reset ${initialPeer.getExpires()}`);
        events = events.reduce((all, e) => {
          if (e.address !== initialPeer.getAddress()) {
            all.push(e);
          }
          return all;
        }, []);

        let dataLatestStr = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);
        let latestHeightRaw = 0;
        if (dataLatestStr === null) {
          const now = Date.now();
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `2:${now}`);
          latestHeightRaw = 2;
        } else {
          latestHeightRaw = dataLatestStr.split(":")[0];
        }
        const latestHeight = parseInt(latestHeightRaw, 10);
        // remove the initial peer
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        await this.resetBlocksFrom(latestHeight);
        // if there are not enough peers left reset headers and try again
      } else if (ipd === 'running') {
        debug('peer sync evalution stopped while ipd === running');
        return Promise.resolve(true);
      }
      // if there are less than 2 event pairs trigger resync
      if (events.length < 2) {
        this._logger.warn('peer sync evaluations incomplete\n  > do not use a shared ip address\n  > clear local chain storage\n  > stop and start the local node\n');
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerevents`, events);
        return Promise.resolve(true);
      }
      // only extract IPH events
      debug(`events to be matched ${events.length}`);
      const unmatched = events.reduce((table, e) => {
        if (e !== undefined && e.address && e.address !== initialPeer.getAddress()) {
          // only process the events of the initial Peer Eval type
          if (e.type === 'initialpeerheaderStart') {
            if (table[e.address] === undefined) {
              table[e.address] = {
                address: e.address,
                startTime: false,
                endTime: false,
                block: false
              };
            }
            table[e.address].startTime = e.timestamp;
          } else if (e.type === 'initialpeerheaderEnd') {
            if (table[e.address] === undefined) {
              table[e.address] = {
                address: e.address,
                startTime: false,
                endTime: false,
                block: false
              };
            }
            table[e.address].endTime = e.timestamp;
            table[e.address].block = e.block;
          }
        }
        return table;
      }, {});
      /* const matched =
       *   [{
       *      startTime: Number
       *      endTime: Number
       *      block: BcBlock
       *   }...]
       */
      debug('unmatched events');
      const matched = Object.keys(unmatched).reduce((pairs, addr) => {
        if (unmatched[addr].startTime !== false && unmatched[addr].endTime !== false && unmatched[addr].block !== false) {
          unmatched[addr].elapsed = unmatched[addr].endTime - unmatched[addr].startTime;
          pairs.push(unmatched[addr]);
        }
        return pairs;
      }, []);
      debug(`matched events: ${matched.length}`);
      if (matched.length >= BC_USER_QUORUM) {
        // sort the matched pairs into a high to low array
        // 1. use block height
        // 2. use difficulty
        debug(`${matched.length} matched events pass BC_USER_QUORUM threshold hold ${BC_USER_QUORUM}`);
        const matchedSorted = matched.sort((a, b) => {
          // TODO: Setup--validate both blocks (not txs)
          // Blocks are the same A === B
          if (a.block.getHash() === b.block.getHash()) {
            // if a was faster than b push ok
            if (a.elapsed < b.elapsed) {
              return 1;
            }
            if (a.elapsed > b.elapsed) {
              return -1;
            }
            return 0;
          }
          // Block are not the same A !== B
          if (new BN(a.block.getTotalDistance()).gte(new BN(b.block.getTotalDistance()))) {
            if (new BN(a.block.getHeight()).gte(new BN(b.block.getHeight()))) {
              // if a is faster at providing headers opt for a
              if (a.elapsed < b.elapsed) {
                return 1;
              }
              // if the start time is earlier the peer connected earlier to the local node
              if (new BN(a.startTime).lt(new BN(b.startTime))) {
                return 1;
              }
              return 0;
            }
            return -1;
            // second option has greater total distance than the first
          } else {
            if (new BN(a.block.getHeight()).gt(new BN(b.block.getHeight()))) {
              if (a.elapsed < b.elapsed) {
                return -1;
              }
              // if a has a greater block height push it forward
              return 1;
            }
            // if second option is also higher block height put forward
            return -1;
          }
        });
        debug(`number of matches sorted: ${matchedSorted.length}`);
        // asign initial sync peer
        const initialSyncPeerRaw = matchedSorted[0]; // Not a protobuf
        const initialPeer = new InitialPeer();
        initialPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
        debug(`assigning initial peer address as ${initialSyncPeerRaw.address}`);
        initialPeer.setAddress(addressToHost(initialSyncPeerRaw.address));
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, initialPeer);
        const latestBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
        const payload = encodeTypeAndData(MESSAGES.HEADER, latestBlock);
        // locate the connection
        const conn = find(({ remoteAddress }) => `${remoteAddress}` === initialPeer.getAddress(), this._discovery.connections);
        if (conn) {
          const result = await this.qsend(conn, payload);
          if (result.success) {
            debug('successful update sent to peer');
          } else {
            this._logger.warn('failed to send peer query');
          }
        } else {
          this._logger.error('failed to assign connection');
        }
      } else {
        this._logger.warn(`peer evaluation requested while below given quorum ${BC_USER_QUORUM}`);
        return Promise.resolve(true);
      }
    } catch (err) {
      this._logger.error(err.message);
      return Promise.reject(new Error(err));
    }
  }

  async isSegmentKnown(blockQueue) {

    if (!blockQueue) {
      return false;
    }

    if (blockQueue.length < 2) {
      return false;
    }

    const firstBlock = blockQueue[0];
    const lastBlock = last(blockQueue);
    let highestKnownHeight = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);

    if (highestKnownHeight) {
      highestKnownHeight = parseInt(highestKnownHeight, 10);
      if (parseInt(lastBlock.getHeight(), 10) > highestKnownHeight - MAX_DATA_RANGE * 2) {
        // requre the last 100 blocks or x2 to the highest known hight to be reprocessed
        return false;
      }
    }

    const localFirstBlock = await this._engine.persistence.getBlockByHash(firstBlock.getHash(), BC_SUPER_COLLIDER, { asHeader: true, cached: true });
    const localLastBlock = await this._engine.persistence.getBlockByHash(lastBlock.getHash(), BC_SUPER_COLLIDER, { asHeader: true, cached: true });
    const linked = [].concat(blockQueue);
    let connectedChain = true;

    while (linked.length > 1) {
      const b = linked.pop();
      if (last(linked).getHash() !== b.getPreviousHash()) {
        connectedChain = false;
      }
    }

    if (localLastBlock && localFirstBlock && connectedChain) {
      return true;
    } else {
      return false;
    }
  }

  /* Inital Peer Headers Test
   * tests each peer with the highest latest block and response latency
   */
  async ipht(block, peerAddr) {
    // get the local highest block
    debug('sendPeerEvaluations(): running');
    if (BC_USER_QUORUM < 2) {
      return true;
    }
    const ipht = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.ipht`);
    if (!ipht) {
      let blockCount = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.ipht.${block.getHash()}`);
      if (!blockCount) {
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.ipht.${block.getHash()}`, [peerAddr]);
        return false;
      } else if (blockCount.length + 1 < BC_IPHT_MINIMUM && blockCount.indexOf(peerAddr) < 0) {
        blockCount.push(peerAddr);
        this._logger.info(`header ${block.getHeight()} : ${block.getHash().slice(0, 21)} : ${blockCount.length}/${BC_IPHT_MINIMUM} added before sync begins`);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.ipht.${block.getHash()}`, blockCount);
        return false;
      } else if (blockCount.length + 1 < BC_IPHT_MINIMUM && blockCount.indexOf(peerAddr) > -1) {
        return false;
      } else {
        blockCount.push(peerAddr);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.ipht.${block.getHash()}`, blockCount);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.ipht`, `${BC_SUPER_COLLIDER}.sync.ipht.${block.getHash()}`);
        return true;
      }
    } else {
      // ipht is complete
      return true;
    }
  }

  /* sendPeerEvaluations
   * tests each peer with the highest latest block and response latency
   */
  async sendPeerEvaluations() {
    // get the local highest block
    debug('sendPeerEvaluations(): running');
    const latestBlock = await this._engine.persistence.get('bc.block.latest');
    if (!latestBlock) {
      this._logger.error('latest block does not exist unable to join peering network');
      return false;
    }
    const payload = encodeTypeAndData(MESSAGES.GET_BLOCK, []);
    if (this._discovery !== undefined && this._discovery.connections.length > 0) {
      debug(`IPH evaluations queued for ${this._discovery.connections.length} connection(s)`);
      try {
        for (const remoteConnection of this._discovery.connections) {
          const address = `${remoteConnection.remoteAddress}:${remoteConnection.remotePort}`;
          if (PEER_QUARANTINE.indexOf(address) > -1) {
            continue;
          }
          debug(`sending eval to address ${address}, local latest block height ${latestBlock.getHeight()}`);
          await this._engine.persistence.updateList('bc.sync.initialpeerevents', {
            address: address,
            timestamp: Number(new Date()),
            type: 'initialpeerheaderStart'
          });
          await this.qsend(remoteConnection, payload);
        }
        return true;
      } catch (err) {
        this._logger.error(err);
        return false;
      }
    } else {
      throw new Error('unable to initialize header sync without peers');
    }
  }

  async processDataMessage(conn, blocks, opts = { innerCall: false }) {

    const address = conn.remoteAddress + ':' + conn.remotePort;
    debug(`received DATA from waypoint ${address}`);
    if (PEER_QUARANTINE.indexOf(addressToHost(address)) > -1) {
      this._logger.warn(`waypoint ${address} in quarantine and attempted to send DATA consider adding to blacklist`);
      //PEER_BLACKLIST.push(addressToHost(address))
      return;
    }
    if (PEER_BLACKLIST.indexOf(addressToHost(address)) > -1) {
      this._logger.warn(`waypoint ${address} in BLACKLIST and attempted to send DATA`);
      return;
    }

    const latestBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
    const ipd = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeerdata`);
    const now = Date.now();
    let currentPeer = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
    const peerExpired = await this._engine.persistence.processPeerExpiration({ chainState: this._engine.chainState });

    if (blocks) {
      // LDL
      debug(`MESSAGES.DATA received [] <- ${blocks.length} blocks`);
    } else {
      // LDL
      debug(`MESSAGES.DATA received from waypoint with malformed blocks`);
      return;
    }

    if (ipd !== 'complete' && !DISABLE_IPH_TEST) {
      this._logger.warn(`waypoint transmitted data running !== ${String(ipd)}`);
      return;
    }

    if (!currentPeer || !currentPeer.setExpires) {
      const reorgBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
      if (reorgBlock) {
        currentPeer = new InitialPeer();
        currentPeer.setAddress(addressToHost(address));
        currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
      } else {
        this._logger.info(`yielding DATA from unset new waypoint ${address} without multiverse change request in place`);
        //return
        currentPeer = new InitialPeer();
        currentPeer.setAddress(addressToHost(address));
        currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
      }
    } else if (currentPeer.setExpires && addressToHost(currentPeer.getAddress()) === addressToHost(address)) {
      currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
    } else if (addressToHost(currentPeer.getAddress()) !== addressToHost(address)) {
      this._logger.info(`DATA from unset new waypoint ${address} ignored <- set waypoint ${currentPeer.getAddress()}`);
      return;
    } else {
      this._logger.warn(`malformed peer ${address} <- no expiration set`);
    }

    if (currentPeer && currentPeer.getExpires && new BN(currentPeer.getExpires()).lt(new BN(now))) {
      await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      currentPeer = null;
    }

    if (!currentPeer && !DISABLE_IPH_TEST) {
      this._logger.warn(`cannot fetch waypoint while handling DATA message`);
      return false;
      // confirm peer is approved to be delivering data
      ///}
      // else if (currentPeer !== null && address !== currentPeer.getAddress()) {
      //   this._logger.warn(`unapproved peer ${address} attempted data stream current approved: ${currentPeer.getAddress()}`)
      //   return
    } else if (!currentPeer && DISABLE_IPH_TEST) {
      currentPeer = new InitialPeer();
      currentPeer.setAddress(addressToHost(address));
      currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
      currentPeer = await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
      this._logger.warn(`current waypoint not available, set to ${address}`);
    }

    if (currentPeer && currentPeer.getAddress && addressToHost(currentPeer.getAddress()) !== addressToHost(address)) {
      this._logger.warn('waypoint has not expired');
      return;
    }

    if (!latestBlock) {
      this._logger.warn(`cannot find 'bc.block.latest' while handling DATA message`);
      return false;
    }

    let highestKnownHeight = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
    if (highestKnownHeight) {
      highestKnownHeight = parseInt(highestKnownHeight, 10);
    }

    const reorgBlockRaw = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
    let dataLatestStr = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);
    let latestHeightRaw = 0;
    if (dataLatestStr === null) {
      const now = Date.now();
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `2:${now}`);
      latestHeightRaw = 2;
    } else {
      latestHeightRaw = parseInt(dataLatestStr.split(':')[0], 10);
    }

    if (reorgBlockRaw && new BN(reorgBlockRaw.getHeight()).gt(new BN(latestHeightRaw))) {
      latestHeightRaw = parseInt(reorgBlockRaw.getHeight(), 10);
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${latestHeightRaw}:${now}`);
    }

    this._syncComplete = false;

    const lowestBlock = blocks[0];
    const innerCallBlocks = [].concat(blocks);
    const requestWindowNumber = parseInt(lowestBlock.getHeight(), 10) % 10000;
    const peerKey = `${address}:${requestWindowNumber}`;
    if (!this._requestRegistry[peerKey]) {
      this._requestRegistry[peerKey] = 0;
    }
    this._requestRegistry[peerKey]++;

    if (this._requestRegistry[peerKey] > 1500) {
      PEER_QUARANTINE.push(address);
      this._logger.info(`peer has recieved maximum number of requests in this block window ${requestWindowNumber}`);
      return;
    }

    const latestHeightRawBoundary = latestHeightRaw + 100 * MAX_DATA_RANGE;
    const lowestBoundaryBlocks = [];
    const finalInvalidBlocks = [];
    const previousBlockTable = {};
    const temporaryBlockStore = {};
    let finalValidBlocks = [];
    let invalidBlockHeights = [];
    let validBlockHeights = [];
    let segmentUnlinked = false;
    let lowestBoundary = false;
    let blocksProvidedOutsideBoundary = false;
    let validDataUpdate = true;
    let currentHeight = latestHeightRaw;
    let highestBlock = false;
    let blocksLength = blocks.length;
    let checkBoundaries = false;
    let highestBoundary = false;
    let invalidData = false;
    let prevBlock = false;
    let validBlocks = 0;
    let scheduledForNextTick = false;
    let minimumValidBlocks = max(0, min(blocks.length - 4, MAX_DATA_RANGE) - 3);
    let blockQueue = blocks;
    let reviewBlockHashes = [];
    let goldlings = 0;
    let segmentKey = false;
    let mountBlockFound = false;
    let highestBlockInQueue = false;
    let genesisBlockInData = false;
    let syncProgress = 0;

    if (blockQueue.length > 0) {
      segmentKey = `${address}${blockQueue.length}${blockQueue[0].getHash()}${blockQueue[blockQueue.length - 1].getHash()}`;
      if (this._knownBlockSegments.has(segmentKey)) {
        debug(`segment is already processed`);
      }
    }

    this._logger.info(`blocks received: ${blocksLength}, blocks queued: ${blockQueue.length}, goldlings: ${goldlings} <- current height on local disk is ${currentHeight}`);

    /*
     * 1. Check if segment is known
     */
    //const segmentKnown = await this.isSegmentKnown(blockQueue)
    const segmentKnown = false;

    /*
     * 2. Process all blocks if segment is not know
     */
    do {
      //for (let newBlock of blockQueue) {
      const newBlock = blockQueue.shift();
      const newBlockBoundary = parseInt(newBlock.getHeight(), 10) + 6;
      temporaryBlockStore[newBlock.getHash()] = newBlock;
      // LDL
      debug(`evaluating block ${newBlock.getHeight()} ${newBlock.getHash().slice(0, 21)}... with highest height boundary: ${latestHeightRawBoundary}, mined by ${newBlock.getMiner()}`);

      if (parseInt(newBlock.getHeight(), 10) < 2) {
        if (!genesisBlockInData) {
          genesisBlockInData = true;
          this._logger.warn(`waypoint sent genesis block which is not expected`);
          PEER_QUARANTINE.push(addressToHost(address));
        } else {
          this._logger.warn(`waypoint sent multiple genesis blocks which is not expected, blacklisting`);
          PEER_BLACKLIST.push(addressToHost(address));
          blocksProvidedOutsideBoundary = true;
          invalidBlockHeights.push(1);
        }
      }

      if (new BN(newBlock.getHeight()).gt(new BN(latestHeightRawBoundary)) && !new BN(latestHeightRawBoundary).eq(new BN(2))) {
        blocksProvidedOutsideBoundary = true;
        continue;
      }
      debug(`processing block ${newBlock.getHeight()} remaining: ${blockQueue.length}`);
      let prevBlock = temporaryBlockStore[newBlock.getPreviousHash()] !== null ? temporaryBlockStore[newBlock.getPreviousHash()] : await this._engine.persistence.getBlockByHash(newBlock.getPreviousHash(), BC_SUPER_COLLIDER, { asHeader: false, cached: false });
      //let prevBlock = await this._engine.persistence.getBlockByHash(newBlock.getPreviousHash(), BC_SUPER_COLLIDER, {asHeader: false, cached: false })
      if (!prevBlock) {
        const prevBlockOpts = await this._engine.persistence.getBlocksByHeight(parseInt(newBlock.getHeight(), 10) - 1, BC_SUPER_COLLIDER, { asHeader: false });
        if (prevBlockOpts) {
          for (let b of prevBlockOpts) {
            if (b.getHash() === newBlock.getPreviousHash()) {
              prevBlock = b;
            }
          }
        }
        if (prevBlock) {
          await this._engine.persistence.putBlock(prevBlock, 0, BC_SUPER_COLLIDER, { asHeader: false });
        }
      }

      if (!prevBlock && newBlockBoundary < highestKnownHeight) {
        this._logger.info(`pending arrival of local mount hash: ${newBlock.getPreviousHash()} to mount ${parseInt(newBlock.getHeight(), 10)} : ${newBlock.getHash()}`);
        if (validBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
          // already valid block at height
          invalidBlockHeights.push(parseInt(newBlock.getHeight(), 10));
        }
        const nb = await this._engine.persistence.getBlocksByHeight(parseInt(newBlock.getHeight(), 10), BC_SUPER_COLLIDER, { asHeader: false, cached: false });
        if (nb) {
          for (let b of nb) {
            if (b.getHash() !== newBlock.getHash() && reviewBlockHashes.indexOf(b.getHash()) < -1) {
              reviewBlockHashes.push(b.getHash());
              blockQueue.unshift(b);
            }
          }
        }
        //segmentUnlinked = true
        await this._engine.persistence.putBlock(newBlock, 0, BC_SUPER_COLLIDER, { asHeader: false, updateHeight: false });
        continue;
      }

      const blockHeight = parseInt(newBlock.getHeight(), 10);
      const blockHash = newBlock.getHash();
      if (this._knownHashes.length > 10000) {
        this._knownHashes.shift();
      }
      if (currentHeight < parseInt(newBlock.getHeight(), 10)) {
        this._syncComplete = false;
        highestBlock = newBlock;
        currentHeight = parseInt(newBlock.getHeight(), 10);
        debug(`set new current height ${currentHeight} and sync complete is now false`);
      }

      if (highestBlock && highestBlockInQueue && parseInt(highestBlockInQueue.getHeight(), 10) > parseInt(highestBlock.getHeight(), 10)) {
        highestBlock = highestBlockInQueue;
      }

      if (!highestBlockInQueue) {
        highestBlockInQueue = newBlock;
      } else if (new BN(highestBlockInQueue.getHeight()).lt(new BN(newBlock.getHeight()))) {
        highestBlockInQueue = newBlock;
      }

      if (this._knownHashes.indexOf(blockHash) > -1 && blockHeight < currentHeight && validBlockHeights.indexOf(blockHeight) < 0) {

        validBlocks++;
        validBlockHeights.push(blockHeight);
        debug(`BLOCK is known ${blockHeight} : ${blockHash} `);
        if (!lowestBoundary || lowestBoundary <= parseInt(newBlock.getHeight(), 10)) {
          // the lowest boundary cannot be the genesis block
          if (parseInt(newBlock.getHeight(), 10) > 1) {
            lowestBoundary = parseInt(newBlock.getHeight(), 10);
            lowestBoundaryBlocks.push(newBlock);
          }
        } else if (!highestBoundary || highestBoundary > parseInt(newBlock.getHeight(), 10)) {
          highestBoundary = parseInt(newBlock.getHeight(), 10);
        }
        continue;
      }
      // if the block is not defined or corrupt reject the transmission
      debug(`processing ${BC_SUPER_COLLIDER} block ${blockHeight} : ${newBlock.getHash()}`);
      if (this._blockRangeLowerBound) {
        if (this._blockRangeLowerBound.height === blockHeight && newBlock && newBlock.getHash) {
          this._blockRangeLowerBound.hash = newBlock.getHash();
          checkBoundaries = true;
        }
      }
      if (this._blockRangeUpperBound) {
        if (this._blockRangeUpperBound.height === blockHeight && newBlock && newBlock.getHash) {
          this._blockRangeUpperBound.hash = newBlock.getHash();
          checkBoundaries = true;
        }
      }
      const block = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.${blockHash}`);
      if (block !== null && newBlock.getHash() !== block.getHash()) {
        // check if the peer simply sent more blocks
        this._logger.info(`newBlock ${newBlock.getHeight()}:${newBlock.getHash()} vs loaded block ${block.getHeight()}:${block.getHash()}`);
      }

      if (parseInt(newBlock.getHeight(), 10) === 2) {
        finalValidBlocks.push(newBlock);
        validBlockHeights.push(parseInt(newBlock.getHeight(), 10));
        this._knownHashes.push(blockHash);
        await this._engine.persistence.putBlock(newBlock, 0, BC_SUPER_COLLIDER, { saveHeaders: true });
        validBlocks++;
        continue;
      }

      if (newBlock !== undefined && newBlock !== null && !invalidData && prevBlock && prevBlock.getHeight && parseInt(newBlock.getHeight(), 10) > 1) {

        const isValidCoinbase = blockQueue.length == 0 ? await validateCoinbase(newBlock, this._engine.persistence, this._engine._txHandler, 'p2p.node') : true;
        if (isValidCoinbase) {
          if (!lowestBoundary || lowestBoundary <= parseInt(newBlock.getHeight(), 10)) {
            // the lowest boundary cannot be the genesis block
            if (parseInt(newBlock.getHeight(), 10) > 1) {
              lowestBoundary = parseInt(newBlock.getHeight(), 10);
              lowestBoundaryBlocks.push(newBlock);
            }
          } else if (!highestBoundary || highestBoundary > parseInt(newBlock.getHeight(), 10)) {
            highestBoundary = parseInt(newBlock.getHeight(), 10);
          }

          if (prevBlock && prevBlock.getHeight() !== newBlock.getHeight()) {

            previousBlockTable[prevBlock.getHash()] = prevBlock;

            let isValidSeq = {
              valid: false
            };
            const mountBlockReq = validateRequireMountBlock(newBlock, prevBlock);
            if (mountBlockReq) {
              this._logger.info(`required block mount of ${mountBlockReq[0].getBlockchain()} ${mountBlockReq[0].getHeight()}`);
              let foundRootBlockToMountBranch = false;
              for (let req of mountBlockReq) {
                const mountBlocks = await this._engine.persistence.getRootedBlockFromBlock(req, [], { returnParents: true });
                if (mountBlocks) {
                  this._logger.info(mountBlocks);
                  // assert this is part of the multichain
                  for (let mb of mountBlocks) {
                    if (foundRootBlockToMountBranch) {
                      continue;
                    }
                    const bl = await this._engine.persistence.getBlockByHash(mb, BC_SUPER_COLLIDER, { asHeader: false, cached: false });
                    if (bl) {
                      isValidSeq = await this._multiverse.validateBlockSequenceInline([newBlock, prevBlock], bl);
                      if (isValidSeq.valid) {
                        foundRootBlockToMountBranch = true;
                        this._logger.info(`mount block located ${bl.getHash().slice(0, 21)}`);
                      }
                    }
                  }
                  if (!foundRootBlockToMountBranch) {
                    this._logger.warn(`unable to find root mount block for sequence ${newBlock.getHeight()} : ${newBlock.getHash().slice(0, 21)}`);
                  }
                }
              }
            } else {
              // LDL
              debug(`mount block not required comparing ${newBlock.getHeight()} : ${newBlock.getHash().slice(0, 4)} - prev: ${newBlock.getPreviousHash().slice(0, 4)}, with prev block ${prevBlock.getHeight()} : ${prevBlock.getHash().slice(0, 4)}`);
              isValidSeq = await this._multiverse.validateBlockSequenceInline([newBlock, prevBlock], false);
            }

            const newBlockHighestChildren = childrenHighestBlock(newBlock);
            const latestBlockLowestChildren = childrenLowestBlock(prevBlock);
            const newBlockLowestChildren = childrenLowestBlock(newBlock);
            const latestBlockHighestChildren = childrenHighestBlock(prevBlock);

            if (prevBlock && new BN(newBlock.getTotalDistance()).lt(new BN(prevBlock.getTotalDistance()))) {
              if (blockQueue[0] && parseInt(blockQueue[0].getHeight(), 10) !== parseInt(newBlock.getHeight(), 10)) {
                const nb = await this._engine.persistence.getBlocksByHeight(parseInt(newBlock.getHeight(), 10), BC_SUPER_COLLIDER, { asHeader: false, cached: false });
                if (nb) {
                  for (let b of nb) {
                    if (b.getHash() !== newBlock.getHash() && reviewBlockHashes.indexOf(b.getHash()) < -1) {
                      reviewBlockHashes.push(b.getHash());
                      blockQueue.unshift(b);
                    }
                  }
                }
              }
              this._logger.warn(`child heights are not valid for given ${newBlock.getHeight()} ${newBlock.getHash()}`);
              if (validBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
                // already valid block at height
                invalidBlockHeights.push(parseInt(newBlock.getHeight(), 10));
              }
              validDataUpdate = false;
              await this._engine.persistence.putBlock(newBlock, 0, BC_SUPER_COLLIDER, { asHeader: false });
              continue;
            }

            if (!isValidSeq.valid && parseInt(newBlock.getHeight(), 10) === parseInt(prevBlock.getHeight(), 10) + 1) {
              if (blockQueue[0] && parseInt(blockQueue[0].getHeight(), 10) !== parseInt(newBlock.getHeight(), 10)) {
                const nb = await this._engine.persistence.getBlocksByHeight(parseInt(newBlock.getHeight(), 10), BC_SUPER_COLLIDER, { asHeader: false, cached: false });
                if (nb) {
                  for (let b of nb) {
                    if (b.getHash() !== newBlock.getHash() && reviewBlockHashes.indexOf(b.getHash()) < -1) {
                      reviewBlockHashes.push(b.getHash());
                      blockQueue.unshift(b);
                    }
                  }
                }
              }
              this._logger.warn(`unconfirmed sequence at ${newBlock.getHeight()} : ${newBlock.getHash()}`);
              if (validBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
                invalidBlockHeights.push(parseInt(newBlock.getHeight(), 10));
              }
              await this._engine.persistence.putBlock(newBlock, 0, BC_SUPER_COLLIDER, { asHeader: false });
              continue;
            } else if (parseInt(newBlock.getHeight(), 10) === parseInt(prevBlock.getHeight(), 10) + 1) {
              const isolatedValidation = isValidBlock(newBlock);
              if (!isolatedValidation) {
                if (validBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
                  invalidBlockHeights.push(parseInt(newBlock.getHeight(), 10));
                }
                // LDL
                debug(`block failed isolated validation test from waypoint ${blockHeight}`);
                validDataUpdate = false;
                continue;
              }
            }
            const purposedBlockChildHeightSum = childrenHeightSum(newBlock);
            const latestBlockChildHeightSum = childrenHeightSum(prevBlock);
            if (new BN(purposedBlockChildHeightSum).lt(new BN(latestBlockChildHeightSum))) {
              this._logger.warn(`child height sumation failed block ${prevBlock.getHeight()} : ${prevBlock.getHash().slice(0, 8)} -> ${newBlock.getHeight()} : ${newBlock.getPreviousHash().slice(0, 8)} missing ${latestBlockChildHeightSum - purposedBlockChildHeightSum}, prev: ${latestBlockChildHeightSum}, new: ${purposedBlockChildHeightSum}`);
              if (blockQueue[0] && parseInt(blockQueue[0].getHeight(), 10) !== parseInt(newBlock.getHeight(), 10)) {
                const nb = await this._engine.persistence.getBlocksByHeight(parseInt(newBlock.getHeight(), 10), BC_SUPER_COLLIDER, { asHeader: false, cached: false });
                if (nb) {
                  for (let b of nb) {
                    if (b.getHash() !== newBlock.getHash() && reviewBlockHashes.indexOf(b.getHash()) < -1) {
                      reviewBlockHashes.push(b.getHash());
                      blockQueue.unshift(b);
                    }
                  }
                }
              }
              if (validBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
                invalidBlockHeights.push(parseInt(newBlock.getHeight(), 10));
              }
              if (validBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) > -1) {
                // already valid block at height
                await this._engine.persistence.putBlock(newBlock, 0, BC_SUPER_COLLIDER, { updateHeight: false });
              } else {
                await this._engine.persistence.putBlock(newBlock, 0, BC_SUPER_COLLIDER);
              }
              continue;
            } else {
              // if the correct new child height block sequence is found remove it and remove the past height (as it has a mount point)
              if (invalidBlockHeights.length > 0) {
                invalidBlockHeights = invalidBlockHeights.filter(b => {
                  if (b !== parseInt(newBlock.getHeight(), 10) && parseInt(newBlock.getHeight(), 10) !== 1) {
                    return b;
                  }
                });
              }
            }

            if (!highestBlockInQueue) {
              highestBlockInQueue = newBlock;
            } else if (new BN(highestBlockInQueue.getHeight()).lt(new BN(newBlock.getHeight()))) {
              highestBlockInQueue = newBlock;
            }

            if (highestKnownHeight) {
              syncProgress = parseInt(newBlock.getHeight(), 10) / parseInt(highestKnownHeight, 10) * 100;
            }
            if (syncProgress > 100) {
              syncProgress = 100;
            }

            if (syncProgress > 0) {
              syncProgress = parseFloat(syncProgress).toFixed(2);
              this._logger.info(`[] <- ${newBlock.getHeight()} : ${newBlock.getHash().slice(0, 32)} NRG Multichain: ${syncProgress}%, miner EMB performance increased: +${this._engine._emblemPerformance}%`);
            }
            finalValidBlocks.push(newBlock);
            validBlockHeights.push(parseInt(newBlock.getHeight(), 10));
            this._knownHashes.push(blockHash);
            if (highestKnownHeight < currentHeight) {
              highestKnownHeight = currentHeight;
            }
            await this._engine.persistence.putBlock(newBlock, 0, BC_SUPER_COLLIDER, { saveHeaders: true });
            validBlocks++;
            continue;
          } else {

            const storedBlock = await this._engine.persistence.putBlock(newBlock, 0, BC_SUPER_COLLIDER, { updateHeader: false });

            if (!new BN(newBlock.getHeight()).eq(new BN(2)) && !prevBlock) {
              this._logger.warn(`new block ${newBlock.getHeight()} height and prev block does not exist and sync complete is now false`);
              this._syncComplete = false;
              // validDataUpdate = false
            }
            // otherwise store the block
            this._logger.warn(`prevBlock false and or new block height ${newBlock.getHeight()}`);
            continue;
          }
        } else {

          if (opts.innerCall && blockQueue.length >= 0) {
            // invalid txs were found in block
            if (blockQueue[0] && parseInt(blockQueue[0].getHeight(), 10) !== parseInt(newBlock.getHeight(), 10)) {
              const nb = await this._engine.persistence.getBlocksByHeight(parseInt(newBlock.getHeight(), 10), BC_SUPER_COLLIDER, { asHeader: false, cached: false });
              if (nb) {
                for (let b of nb) {
                  if (b.getHash() !== newBlock.getHash() && reviewBlockHashes.indexOf(b.getHash()) < -1) {
                    reviewBlockHashes.push(b.getHash());
                    blockQueue.unshift(b);
                    this._logger.info(`adding alternative path at block ${b.getHeight()} : ${b.getHash().slice(0, 21)}`);
                  }
                }
              }
            }
            if (validBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
              invalidBlockHeights.push(parseInt(newBlock.getHeight(), 10));
            }
            this._logger.warn(`sequence confirmation failed block for ${newBlock.getHeight()}`);
            validDataUpdate = false;
            await this._engine.persistence.putBlock(newBlock, 0, BC_SUPER_COLLIDER, { updateHeight: false });
            continue;
          } else if (!opts.innerCall || blockQueue.length !== 0 && blockQueue[0].getHeight() === newBlock.getHeight()) {
            this._logger.info(`internal storage is updating multiverse, yielding evaluation of ${blocks.length} of ${innerCallBlocks.length}`);

            const nb = await this._engine.persistence.getBlocksByHeight(parseInt(newBlock.getHeight(), 10), BC_SUPER_COLLIDER, { asHeader: false, cached: false });
            if (nb) {
              for (let b of nb) {
                if (b.getHash() !== newBlock.getHash() && reviewBlockHashes.indexOf(b.getHash()) < -1) {
                  reviewBlockHashes.push(b.getHash());
                  blockQueue.unshift(b);
                  this._logger.info(`adding alternative path at block ${b.getHeight()} : ${b.getHash().slice(0, 21)}`);
                }
              }
            }
            scheduledForNextTick = true;
            if (validBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
              invalidBlockHeights.push(parseInt(newBlock.getHeight(), 10));
            }

            if (blockQueue.length > 0 && blockQueue[0].getHeight() !== newBlock.getHeight()) {
              blockQueue.unshift(newBlock);
            }
            const tickQueue = [].concat(blockQueue);
            const storedBlock = await this._engine.persistence.putBlock(newBlock, 0, BC_SUPER_COLLIDER);
            process.nextTick(() => {
              setTimeout(async () => {
                await this.processDataMessage(conn, tickQueue, { innerCall: true });
              }, 250);
            });
            continue;
          }
        }
      } else if (parseInt(newBlock.getHeight(), 10) < 4) {
        if (!highestBlockInQueue) {
          highestBlockInQueue = newBlock;
        } else if (new BN(highestBlockInQueue.getHeight()).lt(new BN(newBlock.getHeight()))) {
          highestBlockInQueue = newBlock;
        }
        validBlocks++;
        finalValidBlocks.push(newBlock);
        await this._engine.persistence.putBlock(newBlock, 0, BC_SUPER_COLLIDER);
        continue;
      } else if (!validDataUpdate) {
        this._logger.warn(`malformed block ${newBlock.getHeight()} cannot be processed`);
        continue;
      } else {
        this._logger.info(`unable to validate block in invalid sequence ${newBlock.getHeight()}`);
        continue;
      }
    } while (blockQueue.length > 0 && !blocksProvidedOutsideBoundary && !segmentKnown && !scheduledForNextTick);

    if (scheduledForNextTick) {
      this._logger.info(`segment has been scheduled for evaluation on next ticket`);
      return;
    }

    if (lowestBoundary) {
      const blocksToAttach = await this._engine.persistence.getBlocksByHeight(lowestBoundary - 1, BC_SUPER_COLLIDER, { asHeader: true });
      if (blocksToAttach) {
        for (let b of blocksToAttach) {
          if (mountBlockFound) {
            break;
          }
          for (let l of lowestBoundaryBlocks) {
            if (l.getPreviousHash() === b.getHash()) {
              mountBlockFound = true;
            }
          }
        }
      } else if (lowestBoundaryBlocks.length > 0) {
        for (let l of lowestBoundaryBlocks) {
          if (mountBlockFound) {
            break;
          }
          const prev = await this._engine.persistence.getBlockByHash(l.getPreviousHash(), BC_SUPER_COLLIDER);
          if (prev) {
            mountBlockFound = true;
            break;
          }
        }
      }
    }

    for (let v of invalidBlockHeights) {
      if (validBlockHeights.indexOf(v) < 0) {
        finalInvalidBlocks.push(v);
      }
    }

    if (finalInvalidBlocks.length > 0) {
      debug(`---- INVALID BLOCKS ----`);
      debug(finalInvalidBlocks);
    }

    if (blocksProvidedOutsideBoundary) {
      this._logger.info(`DATA received outside provided boundary: ${latestHeightRawBoundary}`);
      return;
    }

    if (highestBlockInQueue && highestBlock && new BN(highestBlockInQueue.getHeight()).gt(new BN(highestBlock.getHeight()))) {
      highestBlock = highestBlockInQueue;
    }

    if (highestBlockInQueue && !highestBlock) {
      highestBlock = highestBlockInQueue;
    }

    const tn = Date.now();
    const latestBlockHeightFinal = parseInt(latestBlock.getHeight(), 10);
    let evalBlock = latestBlock;
    if (highestBlock) {
      evalBlock = highestBlock;
    }

    if (blocksLength < MAX_DATA_RANGE && validBlocks > 0 && parseInt(evalBlock.getHeight()) < highestKnownHeight) {
      PEER_QUARANTINE.push(addressToHost(address));
      this._logger.info(`waypoint has not provided highest edge (${highestKnownHeight}) yielding multiverse sync <- quarantined waypoint`);
      this._syncComplete = true;
    }

    debug(`block processing complete with eval block height ${evalBlock.getHeight()}`);

    if (!mountBlockFound || segmentUnlinked) {
      PEER_QUARANTINE.push(addressToHost(address));
      const synced = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
      this._logger.warn(`waypoint unable to provide mountable block, all other blocks have been stored pending future evaluation...${address} quarantined, synced status: ${synced}`);
      const reorgBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
      await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      if (synced === 'pending') {
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, 1);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `2:${tn}`);
        await this._engine.persistence.reorgBlockchain(BC_SUPER_COLLIDER);
      } else if (synced === 'complete' && reorgBlock) {
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${parseInt(reorgBlock.getHeight(), 10) - 16}:${tn}`);
        await this._engine.persistence.reorgBlockchain(BC_SUPER_COLLIDER);
      }
      return;
    } else if (finalInvalidBlocks.length > 0 && blocksLength > 2) {

      const synced = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
      const reorgFrom = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
      const fromHeight = reorgFrom ? parseInt(reorgFrom.getHeight(), 10) : 2;
      const fromBlock = reorgFrom ? reorgFrom : getGenesisBlock();
      finalInvalidBlocks.sort();
      // reset known segments
      this._knownBlockSegments.reset();
      // delete the offending peer
      await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      // sets up a special range request case in multiverse
      this._logger.info(`waypoint sent stale blocks, searching for faster nodes`);
      debug(`waypoint sent stale blocks ${address}`);

      // permit up to 3 quarantined peers before moving to searching for a better chain
      if (PEER_QUARANTINE.length > 2) {
        PEER_QUARANTINE.push(addressToHost(address));
        // break the invalid chain
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `2:${tn}`);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, 1);
        await this._engine.persistence.reorgBlockchain(BC_SUPER_COLLIDER, { fromBlock: getGenesisBlock(), iterateUp: false });
      } else if (PEER_QUARANTINE.length < 3 && synced === 'pending' && finalValidBlocks.length > 0 && finalValidBlocks[0].getHash) {
        PEER_QUARANTINE.push(addressToHost(address));
        const finalValidBlock = finalValidBlocks[0];
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${parseInt(finalValidBlock.getHeight(), 10)}:${tn}`);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(finalValidBlock.getHeight(), 10));
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.block.reorgfrom`, finalValidBlock);
        await this._engine.persistence.putLatestBlock(finalValidBlock, BC_SUPER_COLLIDER, { iterateUp: false });
      }
      return;
    }

    if (PEER_QUARANTINE.indexOf(addressToHost(address)) > -1) {
      this._logger.warn(`waypoint provided malformed blocks and has been quarantined`);
      await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      return;
    }

    if (segmentKey) {
      this._knownBlockSegments.set(segmentKey, true);
    }

    if (highestKnownHeight) {
      highestKnownHeight = parseInt(highestKnownHeight, 10);
    } else {
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(evalBlock.getHeight(), 10));
    }

    const latestEdge = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
    const currentHigherLatestEdge = currentHeight >= parseInt(latestEdge, 10);

    if (validBlocks >= minimumValidBlocks && new BN(currentHeight).gte(new BN(latestBlock.getHeight() - 1)) && !invalidData) {
      if (!highestBlock && new BN(currentHeight).gt(latestBlock.getHeight())) {
        highestBlock = await this._engine.persistence.getBlockByHeight(currentHeight, BC_SUPER_COLLIDER, { asBuffer: true });
        if (!highestBlock) {
          highestBlock = latestBlock;
        }
      } else {
        highestBlock = latestBlock;
      }

      debug(`stored block ${highestBlock.getHeight()} as last known latest block current height: ${currentHeight}`);
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${currentHeight}:${now}`);
      await this._engine.persistence.putBlock(highestBlock, 0, BC_SUPER_COLLIDER, { chainState: this._engine.chainState, saveHeaders: true });
      debug(`setting highest block as ${highestBlock.getHeight()}`);
      if (currentHeight === highestKnownHeight && highestKnownHeight !== 1) {
        debug(`current height is greater than or equal to highest known height ${highestKnownHeight}`);
        this._syncComplete = true;
      }
    }

    if (latestEdge && blocksLength < MAX_DATA_RANGE + 6 && validBlocks > 0 && currentHigherLatestEdge && validBlocks >= minimumValidBlocks && finalInvalidBlocks.length < 1) {
      debug(`sync complete is set due to minimum valid blocks and current highest edge ${parseInt(latestEdge, 10)}`);
      if (highestBlockInQueue && parseInt(highestBlockInQueue.getHeight(), 10) > parseInt(highestBlock.getHeight(), 10)) {
        highestBlock = highestBlockInQueue;
      }
      this._syncComplete = true;
    }

    const finalLatestBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
    let dls = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);
    if (!dls) {
      const now = Date.now();
      dls = `${currentHeight}:${now}`;
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, dls);
    }
    const dlh = parseInt(dls.split(':')[0], 10);
    const dt = parseInt(dls.split(':')[1], 10);

    // LDL
    debug(`minimum: ${minimumValidBlocks}, valid: ${validBlocks}, latest req: ${dlh}, latest: ${latestBlock.getHeight()}, edge: ${highestKnownHeight}, eval: ${evalBlock.getHeight()}, current: ${currentHeight}, evaluated: ${validBlocks}, goldlings: ${max(0, blocksLength - validBlocks)}`);

    //const cha = currentHeight - 1
    const chb = currentHeight + 1;
    const chc = currentHeight;
    // const chav = new BN(finalLatestBlock.getHeight()).eq(new BN(cha)) && ((dlh + 200) > highestKnownHeight)
    const chbv = new BN(finalLatestBlock.getHeight()).eq(new BN(chb)) && dlh + 200 > highestKnownHeight;
    const chcv = new BN(finalLatestBlock.getHeight()).eq(new BN(chc)) && dlh + 200 > highestKnownHeight;
    const chdv = !highestBlock ? false : highestBlock.getHash() === latestBlock.getPreviousHash();
    const chev = !highestBlock ? false : highestBlock.getHash() === finalLatestBlock.getPreviousHash();

    // if (chav) {
    //   debug(`the sync is considered complete latestBlock: ${finalLatestBlock.getHeight()} highestCurrent: ${currentHeight} - 1 blocks sent: ${blocks.length}`)
    //   this._syncComplete = true
    // }

    if (chbv) {
      debug(`the sync is considered complete latestBlock: ${finalLatestBlock.getHeight()} highestCurrent: ${currentHeight} - 1 blocks sent: ${blocks.length}`);
      this._syncComplete = true;
    }

    if (chcv) {
      debug(`the sync is considered complete latestBlock: ${finalLatestBlock.getHeight()} highestCurrent: ${currentHeight} blocks sent: ${blocks.length}`);
      this._syncComplete = true;
    }

    if (chdv) {
      debug(`the sync is considered complete latestBlock: ${finalLatestBlock.getHeight()} previous hash equals current highest block hash: ${evalBlock.getHash()}`);
      this._syncComplete = true;
    }

    if (chev) {
      debug(`evalblock completes the hash sequence for latestBlock: ${finalLatestBlock.getHeight()} eval block: ${evalBlock.getHeight()}`);
      this._syncComplete = true;
    }

    if (evalBlock && new BN(evalBlock.getHeight()).lt(new BN(currentHeight))) {
      this._logger.warn(`eval block ${evalBlock.getHeight()} is less than current height`);
      this._syncComplete = false;
    }

    // if boundaries have
    if (checkBoundaries && validBlocks >= minimumValidBlocks) {
      debug(`boundaries have been set lower: ${this._blockRangeLowerBound.height} upper: ${this._blockRangeUpperBound.height}`);
    }

    // LDL
    debug(`processed ${validBlocks} blocks from waypoint filtered to ${finalValidBlocks.length} saved to disk`);
    // if peer sends invalid data it is rejected and removed from the peer data
    if (validBlocks >= minimumValidBlocks && validBlocks > 1 && finalValidBlocks.length < validBlocks && blocksLength < MAX_DATA_RANGE && invalidBlockHeights.length < 1 && parseInt(evalBlock.getHeight(), 10) < highestKnownHeight) {
      this._logger.info(`edge discovered by network that is not available from waypoint, setting initial sync`);
      this._syncComplete = true;
    }

    if (validBlocks < minimumValidBlocks && validBlocks < 1) {
      // reset the best block to the lowest
      this._logger.warn('validDataUpdate === false setting bc.data.latest = 2');
      const now = Date.now();
      PEER_QUARANTINE.push(addressToHost(address));
      this._knownBlockSegments.reset();
      const syncedStatus = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
      await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      if (syncedStatus === 'complete') {
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(finalLatestBlock.getHeight(), 10));
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.block.reorgto`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.data.latest`);
      } else {
        await this._engine.persistence.reorgBlockchain(BC_SUPER_COLLIDER, { chainState: this._engine.chainState });
      }
      await this.processPeerEvaluations();

      // process peer evaluations seeking better candidate
      return;
    } else if (this._syncComplete === false && !invalidData && validBlocks > 0) {
      // update the request to the latest height
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'pending');
      // get the current best block hash + MAX_DATA_RANGE
      const now = Date.now();
      // LDL
      debug(`setting highest height to ${currentHeight}`);
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${currentHeight}:${now}`);

      let nextHeight = min(currentHeight + MAX_DATA_RANGE, highestKnownHeight);
      if (nextHeight <= currentHeight) {
        nextHeight = nextHeight + MAX_DATA_RANGE;
      }
      // LDL
      debug(`opened GET_DATA request for ${address} from local: ${currentHeight} next: ${nextHeight}, e: ${highestKnownHeight}`);

      const peerRequestKey = `${address}:${currentHeight}`;
      if (!this._requestRegistry[peerRequestKey]) {
        this._requestRegistry[peerRequestKey] = 1;
      } else {
        this._requestRegistry[peerRequestKey]++;
      }

      if (this._requestRegistry[peerRequestKey] > 600) {
        // meaning we have asked for clarification on the same segment more than 6 times
        this._logger.warn(`waypoint has requested the same segment too often, placing in temporary quarantine`);
        PEER_QUARANTINE.push(address);
      } else {
        const data = [currentHeight, nextHeight];
        const payload = encodeTypeAndData(MESSAGES.GET_DATA, data);
        const sent = await this.rsend(address, payload, conn);
        if (sent !== undefined && sent.success) {
          // LDL
          debug(`GET_DATA sent to ${sent.address}, message: ${sent.message}`);
        } else {
          debug(`failed to send GET_DATA request to ${address}`);
        }
      }

      const initialPeer = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      if (initialPeer) {
        initialPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, initialPeer);
      }
      for (const finalBlock of finalValidBlocks) {
        const txs = finalBlock.getTxsList();
        // this._engine._txPendingPool.markTxsAsMined(txs, BC_SUPER_COLLIDER)
        debug(`storing ${finalBlock.getHeight()} : ${finalBlock.getHash().slice(0, 12)}`);
        if (this._engine._blockStats) {
          if (this._engine._loggedBcBlocks.indexOf(finalBlock.getHash()) < 0) {
            this._engine._loggedBcBlocks.push(finalBlock.getHash());
            if (!this._engine._loggedBcBalances[finalBlock.getMiner()]) {
              this._engine._loggedBcBalances[finalBlock.getMiner()] = Math.round(finalBlock.getNrgGrant());
            } else {
              this._engine._loggedBcBalances[finalBlock.getMiner()] += Math.round(finalBlock.getNrgGrant());
            }
          }
          this._engine._blockStats.write(`${Math.floor(new Date() / 1000)},${finalBlock.getTimestamp()},${finalBlock.getHeight()},${finalBlock.getHash()},${finalBlock.getDistance()},${finalBlock.getDifficulty()},${finalBlock.getTotalDistance()},${finalBlock.getMiner().slice(2, 30)},${this._engine._loggedBcBalances[finalBlock.getMiner()]},${finalBlock.getTxsList().length},${Math.round(finalBlock.getNrgGrant())}\n`);
        }
      }

      debug(`sync is not complete, highest height is ${currentHeight} -> setting ${BC_SUPER_COLLIDER}.data.latest: ${currentHeight} set initialsync: pending`);
      const dataLatestStr = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);
      const dataLatest = parseInt(dataLatestStr.split(':')[0], 10);
      const dataTimestamp = parseInt(dataLatestStr.split(':')[1], 10);

      if (highestBoundary) {
        const lengthOfGivenBlockRange = highestKnownHeight - highestBoundary;
        if (validBlocks > 0 && currentHeight < highestKnownHeight && lengthOfGivenBlockRange < 12) {
          this._logger.warn(`waypoint ${address} is not aware of the edge being saught ${highestKnownHeight} after providing ${lengthOfGivenBlockRange}, placing in temporary quarantine <- highest boundary: ${highestBoundary}`);
          await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${currentHeight}:${now}`);
          return;
        }
      }

      if (highestBlockInQueue && parseInt(highestBlockInQueue.getHeight(), 10) > parseInt(highestBlock.getHeight(), 10)) {
        debug(`running highest block in queue after all blocks have been evaluated ${highestBlockInQueue.getHeight()}`);
        highestBlock = highestBlockInQueue;
      }
    } else if (this._syncComplete === true && !invalidData) {
      debug(`multichain highest edge set <- ${currentHeight}`);
      const now = Date.now();

      const finalTxTable = {};
      const altTxTable = {};
      for (const finalBlock of finalValidBlocks) {
        if (this._engine._blockStats) {
          if (this._engine._loggedBcBlocks.indexOf(finalBlock.getHash()) < 0) {
            this._engine._loggedBcBlocks.push(finalBlock.getHash());
            if (!this._engine._loggedBcBalances[finalBlock.getMiner()]) {
              this._engine._loggedBcBalances[finalBlock.getMiner()] = Math.round(finalBlock.getNrgGrant());
            } else {
              this._engine._loggedBcBalances[finalBlock.getMiner()] += Math.round(finalBlock.getNrgGrant());
            }
          }
          this._engine._blockStats.write(`${Math.floor(new Date() / 1000)},${finalBlock.getTimestamp()},${finalBlock.getHeight()},${finalBlock.getHash()},${finalBlock.getDistance()},${finalBlock.getDifficulty()},${finalBlock.getTotalDistance()},${finalBlock.getMiner().slice(2, 30)},${this._engine._loggedBcBalances[finalBlock.getMiner()]},${finalBlock.getTxsList().length},${Math.round(finalBlock.getNrgGrant())}\n`);
        }
      }

      this._logger.info(``);
      this._logger.info(``);
      this._logger.info(`NRG multichain has reached global state, ready for block collisions`);
      this._logger.info(``);
      this._logger.info(``);
      if (BC_BIND_PEER) {
        this._logger.info(`[] -> [ ] released bining to peer: ${BC_BIND_PEER}`);
        BC_BIND_PEER = false;
      }

      // MMM
      await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.data.latest`);
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'complete');
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerheader`, 'complete');
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerdata`, 'complete');
      await this._engine.persistence.reorgBlockchain(BC_SUPER_COLLIDER, {
        chainState: this._chainState,
        reorgTo: true,
        toBlock: evalBlock
      });
    } else if (invalidData) {
      this._logger.warn(`invalid data, clear data from waypoint on local disk`);
    } else {
      // get the current best block with data
      if (!highestBlock) {
        highestBlock = await this._engine.persistence.getBlockByHeight(currentHeight, BC_SUPER_COLLIDER, {
          asBuffer: true,
          asHeader: false
        });
        if (!highestBlock) {
          highestBlock = latestBlock;
        }
      }
      // get the current best block hash + MAX_DATA_RANGE
      const nextHeight = min(currentHeight + MAX_DATA_RANGE, parseInt(highestBlock.getHeight(), 10) + parseInt(latestBlock.getHeight(), 10));
      let nextHighestBlock = await this._engine.persistence.getBlockByHeight(nextHeight);
      this._logger.info(`highestBlock: ${highestBlock.getHeight()} nextHighestBlock: ${nextHighestBlock}`);
      let data = '';
      if (!nextHighestBlock) {
        data = [highestBlock.getHeight(), parseInt(highestBlock.getHeight(), 10) + MAX_DATA_RANGE];
      } else {
        data = [highestBlock.getHeight(), nextHighestBlock.getHeight()];
      }
      const payload = encodeTypeAndData(MESSAGES.GET_DATA, data);
      const sent = await this.rsend(address, payload, conn);
      if (sent !== undefined) {
        debug(`GET_DATA sent: ${sent}`);
      }
    }
  }

  /*  checkInitialPeerHeaderStatus
   *  Determines if the performance testing blocks should be sent to peers
   */
  async checkInitialPeerHeaderStatus(iph = null) {
    // get the iph state
    // !!! this should not be run unless quorum has been achieved !!!
    // 'pending' = iph evaluation evaluations are waiting for first candidate
    // 'complete' = iph evaluation process has been completed
    // 'error' = iph evaluation process has started
    if (iph === null) {
      iph = await this._engine.persistence.get('bc.sync.initialpeerheader');
      // if it still is undefined fail the request
      if (!iph) {
        throw new Error('unable to determine status of initial peer evaluation');
      }
    }
    debug(`current initialpeerheader state: ${iph}`);
    // create list
    if (iph === null || iph === undefined) {
      return false;
    } else if (iph === 'pending') {
      // switch rom pending to running and emit block challenges to peers
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerheader`, 'running');
      // send the initial block calls to available peers in quorum
      const evaluationsSent = await this.sendPeerEvaluations();
      if (evaluationsSent !== true) {
        debug('initial peer evaluations canceled');
        return false;
      }
      return true;
    } else if (iph === 'running') {
      this._logger.info('yielding peer evaluation');
      return false;
    } else if (iph === 'error') {
      this._logger.error('critical error in initial block sync. Check log files.');
      return false;
    }
    return true;
  }

  async start(nodeId) {
    const discovery = new Discovery(nodeId);
    this._discovery = discovery.start();
    /*
     * Local state is made a clean set before IPH and IPD tests have be started
     */
    this._logger.info(`node p2p starting ${nodeId}`);
    await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'pending'); // set the iph status
    await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerheader`, 'pending'); // set the iph status
    await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerdata`, 'pending'); // set the ipd status
    await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeernum`, 0); // reset the counter for peers
    await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerevents`, []); // empty the reports for block timing
    await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`); // erase the peer
    await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.ipht`);

    this._engine._asyncEmitter.on('requestBlockRange', async range => {

      if (this._blockRangeUpperBound && this._blockRangeLowerBound && this._blockRangeUpperBound.height === range[0] && this._blockRangeLowerBound.height === range[1]) {
        debug(`range request is already set in rover`);
      }
      if (!range) {
        this._logger.info(`no range provided from request block range event`);
        return Promise.resolve(false);
      }
      if (range[0] === range[1]) {
        this._logger.error(`range window cannot be of size 0 <- ${range[0]} !== ${range[1]}`);
        return Promise.resolve(false);
      }

      const reorgBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
      if (reorgBlock && reorgBlock !== null) {
        if (range[1] > parseInt(reorgBlock.getHeight(), 10) && parseInt(reorgBlock.getHeight(), 10) > 1) {
          debug(`extend multiverse to ${reorgBlock.getHeight()} paused <- multiverse is already changing`);
          return false;
        } else if (range[1] <= parseInt(reorgBlock.getHeight(), 10)) {
          debug(`range below multiverse to ${reorgBlock.getHeight()} -> pushing for request`);
        }
      }

      this._blockRangeUpperBound = { height: range[0], hash: false };
      this._blockRangeLowerBound = { height: range[1], hash: false };
      let lowest = max(2, range[1]);
      let highest = max(lowest + 1, range[0]);
      if (highest !== lowest) {
        debug(`requesting block range from ${this._discovery.connections.length} waypoints <- highest: ${highest}, lowest: ${lowest}`);
        const iph = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeerheader`);
        const ipd = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeerdata`);
        const latestBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
        const now = Date.now();
        let currentPeer = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        let dataLatestStr = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);
        let latestSyncedHeight = 1;
        if (currentPeer && new BN(currentPeer.getExpires()).lt(new BN(now))) {
          await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
          currentPeer = null;
        }
        if (dataLatestStr) {
          const dataLatest = parseInt(dataLatestStr.split(':')[0], 10);
          const dataTimestamp = parseInt(dataLatestStr.split(':')[1], 10);
          latestSyncedHeight = parseInt(dataLatestStr.split(":")[0], 10) < highest ? highest : parseInt(dataLatestStr.split(":")[0], 10);
          lowest = new BN(latestSyncedHeight).lt(new BN(lowest)) ? latestSyncedHeight : lowest;
          const nodeIsSynced = latestSyncedHeight && latestBlock && new BN(latestBlock.getHeight()).eq(new BN(latestSyncedHeight));
          if (now < dataTimestamp + 3600) {
            this._logger.warn(`request is approaching threshold`);
            //return
          }
        }
        const payload = encodeTypeAndData(MESSAGES.GET_DATA, [lowest - 1, highest]);
        debug(`latest synced height ${latestSyncedHeight}, latest block height: ${latestBlock.getHeight()}`);
        if (DISABLE_IPH_TEST) {
          debug(`DISABLE_IPH_TEST === true this means the range requests from any peer should not be ignored highest: ${highest} lowest: ${lowest}`);
        } else if (iph !== 'complete' || ipd !== 'complete') {
          this._logger.warn(`cannot request block range while conducting IPD / IPH testing <- IPH: ${iph} IPD: ${ipd}`);
          return;
        }

        if (parseInt(latestSyncedHeight, 10) >= highest && parseInt(latestBlock.getHeight(), 10) >= highest) {
          this._logger.warn(`latestBlockHeight: ${latestBlock.getHeight()} latestSyncedHeight: ${latestSyncedHeight} highest: ${highest} possible duplicate request`);
        }

        if (this._discovery.connections) {

          let t = 0;
          let p = 0;

          // range  = [highest, lowest, ?connection]
          // if connection supplied this is a direct range request
          if (range[2]) {
            const remoteConnection = range[2];
            const address = `${remoteConnection.remoteAddress}:${remoteConnection.remotePort}`;
            const sendToAnyPeer = !currentPeer ? true : addressToHost(currentPeer.getAddress()) === addressToHost(address);
            // LDL
            debug(`creating direct request -> agnostic: ${sendToAnyPeer}, address: ${address}, p: ${p}`);
            if (sendToAnyPeer && PEER_QUARANTINE.indexOf(addressToHost(address)) < 0 && p < 1 && PEER_BLACKLIST.indexOf(address) < 0) {
              // LDL
              debug(`sending range request to address ${address} from ${lowest} to ${highest}`);
              p += 1;
              const sent = await this.rsend(address, payload, remoteConnection);
              if (sent && sent.success) {
                this._logger.info(`range request sent ${lowest} -> ${highest}`);
              } else {
                this._logger.warn(`failed range request ${lowest} -> ${highest}...resending to range...`);
                this._engine._asyncEmitter.emit('requestBlockRange', [range[0], range[1]]);
              }
            } else if (!sendToAnyPeer) {
              // LDL
              debug(`waypoint  unavailable range request to address ${address} from ${lowest} to ${highest}`);
            }
          } else {

            // the goal of this for loop is to find a peer willing to send the range
            // once a range is recieved currentPeer gets assigned and breaks the for loop
            // gradually the timeout to request increases to give previous requests a chance to respond
            for (const remoteConnection of this._discovery.connections) {
              const address = `${remoteConnection.remoteAddress}:${remoteConnection.remotePort}`;
              const hasCurrentPeer = !currentPeer ? false : addressToHost(currentPeer.getAddress()) === addressToHost(address);
              debug(`has current peer: ${hasCurrentPeer}, address: ${address}, p: ${p}, t: ${t}`);

              if (hasCurrentPeer && PEER_QUARANTINE.indexOf(addressToHost(address)) < 0 && PEER_BLACKLIST.indexOf(addressToHost(address)) < 0) {
                p += 1;
                this._logger.info(`current peer handling broadcast range request to address ${address} from ${lowest} to ${highest}`);
                await this.rsend(address, payload, remoteConnection);
                break;
              } else if (hasCurrentPeer) {
                this._logger.info(`yielding broadcast range request to address ${address}`);
                continue;
              } else if (!hasCurrentPeer && p < BC_MAX_CONNECTIONS && PEER_QUARANTINE.indexOf(addressToHost(address)) < 0 && PEER_BLACKLIST.indexOf(addressToHost(address)) < 0) {
                t = t + 350;
                p += 1;
                currentPeer = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
                this._logger.info(`broadcasting range request to address ${address} from ${lowest} to ${highest} with window ${t} and p: ${p}`);
                if (currentPeer) {
                  // a peer and therefore response was established
                  return;
                }
                // continue requesting
                await this.rsend(address, payload, remoteConnection);
              } else {
                debug(`NOT broadcasting range request to address ${address} from ${lowest} to ${highest}`);
              }
            }
          }
        } else {
          this._logger.warn(`no available connections`);
        }
      } else {
        debug(`no connections to request range of ${lowest} ${highest}`);
      }
    });
    /* Start multiverse sync */
    this._discovery.on('connection', async (conn, peer) => {
      try {
        // pass connection to connection pool
        // create peer sync group <- sort peers by best block
        // sync backwards from top to bottom if a peer fails switch
        // begin syncing after pool size
        const address = conn.remoteAddress + ':' + conn.remotePort;
        debug(`seeder posted peer update ${address}`);
        let roverSyncComplete = this._engine.rovers.areRoversSynced();
        // greeting reponse to connection with provided host information and connection ID

        const iph = await this._engine._persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeerheader`);
        // if the initial peer num has not been set we need to set it
        // this could have happened if the local node crashed on startup
        if (iph === null && !DISABLE_IPH_TEST) {
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerdata`, 'pending');
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerheader`, 'pending');
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeernum`, 0);
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerevents`, []);
        }
        // get heighest block
        const quorumState = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.dht.quorum`);
        let quorum = parseInt(quorumState, 10); // coerce for Flow
        if (this._discovery.connected < BC_USER_QUORUM && quorum === 1 && MIN_HEALTH_NET === false) {
          quorum = 0;
          await this._engine.persistence.put('bc.dht.quorum', 0);
        } else if (this._discovery.connected >= BC_USER_QUORUM && quorum === 0) {
          quorum = 1;
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.dht.quorum`, 1);
        } else if (quorum === 0 && MIN_HEALTH_NET === true) {
          quorum = 1;
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.dht.quorum`, 1);
        }

        let mod = 1;
        //conn.setContentSize(_MAX_FRAME_SIZE)
        if (conn && conn.setNoDelay) {
          conn.setNoDelay(true);
        }
        conn.setMaxListeners(0);
        conn.pipe(framer.decode(FRAMING_OPTS).once('error', e => {
          this._logger.error(`Error while decoding length-prefixed packed, e: ${e.message}`);
        })).on('data', async data => {
          await this.peerDataHandler(conn, peer, data);
        });
        conn.once('error', err => {
          debug(`waypoint disconnected ${address}`);
          // LDL
          debug(err);
        });
        conn.once('exit', err => {
          debug('connection closed');
          // LDL
          debug(err);
          try {
            const id = conn.id ? conn.id : peer.id;
            if (this._discovery.dht._peersSeen[id]) {
              delete this._discovery.dht._peersSeen[id];
            }
          } catch (_) {
            this._logger.error(new Error('connection did not gracefully exit'));
          }
        });

        debug(`received connection from ${address}, peer %o`, peer);
        debug(`-- peer metrics --\n  roverSyncComplete: ${roverSyncComplete}\n  iph: ${iph}\n  quorum: ${quorum}`);
        /// if IPH is complete add the peer's connection and pipe the data into peerDataHandler otherwise ignore it
        const traditionalSync = iph === 'complete' && roverSyncComplete && quorum === 1;
        if (traditionalSync && !DISABLE_IPH_TEST) {
          debug('iph: complete, roverSyncCompelte: true, quorum: 1, -> send latest block');

          const latestBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
          if (!latestBlock) {
            this._logger.error(`latest block does not exist unable to join peering network at: ${address}`);
            return;
          }

          if (parseInt(latestBlock.getHeight(), 10) < 2) {
            // if genesis block empty the txs
            latestBlock.clearTxsList();
          }

          const payload = encodeTypeAndData(MESSAGES.BLOCK, latestBlock);
          try {
            // since we dont know we want to communicate with this waypoint use safe qsend
            await this.qsend(conn, payload);
          } catch (err) {
            debug(`debug occured handshaking with ${address}`);
            debug(err);
          }
          // if rovers have completed a sync begin evaluating peers
        } else if (iph !== 'complete' && DISABLE_IPH_TEST === false && roverSyncComplete && quorum === 1) {
          debug('roverSyncComplete: true + quorum = 1, -> checkInitialPeerHeaderStatus');
          try {
            const iphStatus = await this.checkInitialPeerHeaderStatus(iph);
            if (iphStatus !== true) {
              debug(`warning initial Peer Evaluation Status = ${String(iphStatus)}`);
            }
          } catch (err) {
            debug('critical error get initialpeerheaderStatus');
            console.trace(err);
            this._logger.error(err);
            return;
          }
          // if either rover sync is not complete or quorum has not been achieved
        } else if (DISABLE_IPH_TEST) {
          /*
           * AT First Waypoint Handshake
           * Waypoints compare initial blocks if reorg is not already set
           */
          if (PEER_BLACKLIST.indexOf(addressToHost(address)) > -1) {
            this._logger.error(`peer attempting to handshake: ${address}`);
            this._discovery.removePeer(this._discovery.hash, peer);
            return;
          }

          const synced = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
          if (!synced || synced === 'pending') {
            return;
          }

          const latestBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
          if (!latestBlock) {
            this._logger.error(`latest block does not exist unable to join peering network at: ${address}`);
            return;
          }

          if (parseInt(latestBlock.getHeight(), 10) < 2) {
            // if genesis block empty the txs
            latestBlock.clearTxsList();
          }

          const payload = encodeTypeAndData(MESSAGES.BLOCK, latestBlock);
          await this.qsend(conn, payload);
        } else {
          if (!roverSyncComplete) {
            if (quorum === 0) {
              this._logger.info(`peer updated ${address} in connection pool -> waiting for rover "all clear" and quorum to be reached`);
            } else {
              this._logger.info(`peer updated ${address} in connection pool -> waiting for rover "all clear"`);
            }
          } else if (!DISABLE_IPH_TEST) {
            // rovers sync is true so quorum = 0
            this._logger.info(`peer updated ${address} in connection pool -> waiting for quorum to be achieved`);
          }
        }
      } catch (err) {
        console.trace(err);
        this._logger.error(err);
      }
    });

    this._discovery.join(this._discovery.hash, this._discovery.port, data => {
      /* event listener: sendblockcontext */
      this._logger.info(`joined waypoint table: ${this._discovery.hash}`);

      this._engine._emitter.on('sendblockcontext', async msg => {
        if (msg.data.constructor === Array.constructor) return;
        const payload = encodeTypeAndData(MESSAGES.BLOCK, msg.data);
        return this.safeQSend(msg.connection, payload);
      });
      /* event listener: sendblock */
      this._engine._asyncEmitter.on('sendblock', msg => {
        let type = MESSAGES.BLOCK;
        if (msg.type !== undefined) {
          type = msg.type;
        }
        const payload = encodeTypeAndData(type, msg.data);
        const addr = msg.connection.remoteAddress + ':' + msg.connection.remotePort;
        this.qsend(msg.connection, payload).then(() => {
          this._logger.info('block sent!');
        }).catch(err => {
          this._logger.warn('critical block rewards feature is failing with this error');
          this._logger.error(err);
        });
      });

      /*
       * Engine announces emits block to be sent to peers
       */
      this._engine._asyncEmitter.on('announceblock', msg => {
        const payload = encodeTypeAndData(MESSAGES.BLOCK, msg.data);
        debug(`broadcasting block ${msg.data.getHeight()} to ${this._discovery.connections.length} waypoints`);
        const tasks = this._discovery.connections.map(conn => {
          const addr = conn.remoteAddress + ':' + conn.remotePort;
          if (msg.data.getHash !== undefined) {
            // TODO: during a reorg this needs to get reset if the block already seen is now again recent
            if (this._noDoubleSent.has(addressToHost(addr) + msg.data.getHash())) {
              debug(`waypoint ${addr} previously notified of block ${msg.data.getHash()}`);
              return;
            } else {
              this._noDoubleSent.set(addressToHost(addr) + msg.data.getHash(), 1);
              this._engine._knownBlocksCache.set(msg.data.getHash(), true);
            }
          }
          debug(`announcing block to ${addressToHost(addr)}`);
          return this.qsend(conn, payload);
        });
        return Promise.all(tasks).then(() => {
          debug('block announced to network!');
        }).catch(err => {
          this._logger.info('not all connections reached network');
        });
      });
      /*
       * Event fired in engine when a new TX is accepted via RPC or as resend of such received pending TX
       */
      this._engine._asyncEmitter.on('announceTx', msg => {
        const payload = encodeTypeAndData(MESSAGES.TX, msg.data);
        if (this._engine._knownTxsCache.has(msg.data.getHash())) {
          return;
        }

        const seconds = Math.floor(new Date() / 1000);
        if (!this._txRateLimiter[seconds]) {
          this._txRateLimiter = {};
          this._txRateLimiter[seconds] = 1;
        } else if (this._txRateLimiter[seconds] < BC_MAX_TX_RANGE) {
          this._txRateLimiter[seconds]++;
        } else {
          return;
        }

        // this.clearTxRateLimiter()

        this._engine._knownTxsCache.set(msg.data.getHash(), true);
        const tasks = this._discovery.connections.map(conn => {
          const addr = conn.remoteAddress + ':' + conn.remotePort;
          // !!! IMPORTANT No double sent is not set here as TX hashes can be the same and so resubmission is valid !!!
          if (msg.conn && conn.remoteAddress === msg.conn.remoteAddress && conn.remotePort === msg.conn.remotePort) {
            // DEBUG
            debug(`preventing resending tx ${msg.conn.remoteAddress}`);
            return;
          } else if (this._noDoubleSent.has(addressToHost(addr) + msg.data.getHash())) {
            debug(`preventing tx echo ${addressToHost(addr)}`);
            return;
          }
          return this.qsend(conn, payload);
        });
        return Promise.all(tasks).then(() => {
          debug('transactions announced to network!');
        }).catch(err => {
          this._logger.warn('connection failure when announcing to network');
          this._logger.error(inspect(err));
        });
      });

      this._logger.info('far reaching discovery module successfully connected');

      /* event listener: getmultiverse [DEPRICATED] */
      this._engine._emitter.on('getmultiverse', obj => {
        const { data: { low, high } } = obj;
        const payload = encodeTypeAndData(MESSAGES.GET_MULTIVERSE, [low, high]);
        this.qsend(obj.connection, payload).then(res => {
          if (res.success && res.allSent) {
            this._logger.info(`${payload.length} delivered in getmultiverse msg`);
          }
        }).catch(err => {
          this._logger.error('critical write to waypoint socket failed');
          this._logger.error(err);
        });
      });

      // TODO: depricate this
      // local event emitted when chain reorg has started
      this._engine._emitter.on('reorgstart', msg => {
        let blocks = msg;
        if (msg.data !== undefined) {
          blocks = msg.data;
        }
        this._logger.warn(`multiverse change occured of ${blocks.length} blocks from block ${blocks[0].getHeight()} to ${blocks[blocks.length - 1].getHeight()}`);
      });

      this._engine._emitter.on('reorgend', msg => {
        let blocks = msg;
        if (msg.data !== undefined) {
          blocks = msg.data;
        }
        this._logger.warn(`multiverse change occured of ${blocks.length} blocks from block ${blocks[0].getHeight()} to ${blocks[blocks.length - 1].getHeight()}`);
      });

      // local <---- peer sent multiverse
      this._engine._emitter.on('putmultiverse', msg => {
        this._engine.getMultiverseHandler(msg.connection, msg.data).then(res => {
          this._logger.info(res);
        }).catch(err => {
          this._logger.error(err.message);
        });
      });

      // local ----> get block list from peer
      // this._engine._emitter.on('getblocklist', (request) => {
      //   const {low, high} = request.data
      //   const payload = encodeTypeAndData(MESSAGES.GET_BLOCKS, [low, high])
      //   const c = request.connection || request.conn
      //   this.qsend(c, payload)
      // })

      // local <---- peer sent blocks
      // this._engine._emitter.on('putblocklist', (msg) => {
      //   this._engine.stepSyncHandler(msg)
      //     .then(() => {
      //       this._logger.debug('stepSync complete sent')
      //     })
      //     .catch((err) => {
      //       this._logger.error(err.message)
      //     })
      // })

      // local <---- peer sent block
      // this._engine._emitter.on('putblock', (msg) => {
      //   this._logger.debug('candidate block ' + msg.data.getHeight() + ' received')
      //   let options = {fullBlock: false, sendOnFail: false}
      //   if (msg.options) {
      //     options = merge(options, msg.options)
      //   }
      //   debug('event->putblock tracing ipd and iph')
      //   debug(msg.options)
      //   this._engine._emitter.emit('blockFromPeer', {conn: msg.connection, newBlock: msg.data, options: options})
      // })

      // local <---- peer sent range of blocks to be compared with local
      // this._engine._emitter.on('putblockranges', (msg) => {
      //   this._logger.debug('candidate block ' + msg.data.getHeight() + ' received')
      //   let options = {fullBlock: false, sendOnFail: false}
      //   if (msg.options) {
      //     options = merge(options, msg.options)
      //   }
      //   debug('event->putblock tracing ipd and iph')
      //   debug(msg.options)
      //   this._engine._emitter.emit('blockFromPeer', {conn: msg.connection, newBlock: msg.data, options: options})
      // })

      // local <---- peer sent full block
      // this._engine._emitter.on('putfullblock', (msg) => {
      //   const {connection, data} = msg
      //   let options = {fullBlock: true, sendOnFail: false}
      //   if (msg.options) {
      //     options = merge(options, msg.options)
      //   }
      //   this._logger.debug('Received full block with TXs from waypoint')
      //   debug('event->putblock tracing ipd and iph')
      //   debug(options)
      // })

      // local ----> get txs list from peer
      // this._engine._emitter.on('getTxs', (request) => {
      //   const {dimension, id} = request
      //   const payload = encodeTypeAndData(MESSAGES.GET_TXS, [dimension, id])
      //   this._logger.debug(`Requesting full block(s) (${dimension}: ${id}) from waypoint`)
      //   this.qsend(request.connection, payload)
      // })

      // local ----> get header list from peer
      // this._engine._emitter.on('getheaders', (request) => {
      //   const {low, high} = request.data
      //   const payload = encodeTypeAndData(MESSAGES.GET_HEADERS, [low, high])
      //   this.qsend(request.connection, payload)
      // })

      // local ----> get header list from peer
      // this._engine._emitter.on('getdata', (request) => {
      //   const [low, high] = request.data
      //   this._logger.info(`requesting getdata event range low: ${low} high: ${high}`)
      //   const payload = encodeTypeAndData(MESSAGES.GET_DATA, [low, high])
      //   this.qsend(request.connection, payload)
      // })
      this._logger.info('opened active waypoint registry');
    });
    /*
     * PEER SEEDER
     * Seeks out new potential Block Collider nodes (run by wise people).
     */
    let seenPeers = [];
    this._discovery._seeder = discovery.seeder();
    this._discovery._seeder.setMaxListeners(250);
    this._discovery._seeder.on('peer', peer => {
      if (this._discovery.connected > BC_MAX_CONNECTIONS) {
        debug('passed on waypoint handle <- ' + this._discovery.connected + ' connections');
        return;
      }

      const channel = this._discovery.hash;
      const url = Url.parse(peer);
      const h = url.href.split(':');
      const obj = {
        host: h[0],
        port: Number(h[1]) + 1, // seeder broadcasts listen on one port below the peers address
        retries: 0,
        channel: Buffer.from(channel)
      };
      obj.id = obj.host + ':' + obj.port;
      obj.remotePort = obj.port;
      obj.remoteHost = obj.host;

      if (seenPeers.indexOf(obj.remoteHost) < 0) {
        seenPeers.push(obj.remoteHost);
        try {
          const name = obj.host + ':' + obj.port + this._discovery.hash;
          debug(`broadcasting waypoint ${name} from to network`);
          this._discovery._discovery.emit('peer', name, obj, 'tcp');
        } catch (err) {
          this._logger.warn(`Error while constructing waypoint from discovered waypoint: ${inspect(peer)}`);
        }
        seenPeers.unshift();
      }
    });
    this._discovery._seeder.start();

    setInterval(() => {
      seenPeers.pop();
      if (seenPeers.length > 100) {
        seenPeers = seenPeers.slice(0, 50);
      }
    }, 60000);

    return Promise.resolve(true);
  }

  async peerDataHandler(conn, info, str) {

    debug(`waypointDataHandler() dsize: ${str.length} bufstart: ${str.slice(0, 7).toString('ascii')}`);
    if (!str) {
      debug(`waypointDataHandler(): function called without payload`);
      return;
    }
    if (str.length < 7) {
      debug(`waypointDataHandler(): payload smaller than expected size ${str.length} < 7`);
      return;
    }
    if (str.length > _MAX_FRAME_SIZE) {
      debug(`waypointDataHandler(): payload larger than max frame size ${str.length} > ${_MAX_FRAME_SIZE}`);
      return;
    }

    // TODO: add lz4 compression for things larger than 1000 characters
    const type = str.slice(0, 7).toString('ascii');
    debug(`message received type: ${type}`);
    if (!contains(type, values(MESSAGES))) {
      debug(`unknown type received from waypoint`);
      return;
    }

    let currentPeer = false;
    const iph = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeerheader`);
    // if the iph status is running and the message type is not a block or an announced tx ignore the message
    if (DISABLE_IPH_TEST === false) {
      if (iph === 'running' &&
      // The following types are not permitted while IPH is running:
      type !== MESSAGES.BLOCK && type !== MESSAGES.BLOCKS && type !== MESSAGES.HEADER && type !== MESSAGES.HEADERS) {
        debug(`ignoring type: ${type} message from waypoint`);
        return;
      } else if (iph === 'complete' && type === MESSAGES.BLOCK) {
        const ipd = await this._engine.persistence.get('bc.sync.initialpeerdata');
        if (ipd !== 'complete') {
          debug(`ignoring type: ${type} from block submitted by waypoint while IPD is ${ipd}`);
          return;
        }
      }
    }
    // check if the submission of the current peer was late
    if (iph === 'running' && DISABLE_IPH_TEST === false) {
      const ipd = await this._engine.persistence.get('bc.sync.initialpeerdata');
      // redefine currentPeer from false to the current local state
      currentPeer = await this._engine.persistence.get('bc.sync.initialpeer');
      // end the transaction if any of these events are true
      // if no object represents current peer the node has not fully started up or has crashed during startup
      // if expires is not defined the peer challenge was stored corruptly
      // if the initial peer data variable is not pending then a new peer evaluation should not be run in parallel
      if (ipd !== null && ipd !== 'pending') {
        if (!currentPeer) {
          debug(`current ipd: ${ipd}`);
          this._logger.warn('prevented initial peer headers from performing concurrent requests');
          return;
        }
        // reprocess peer evaluations if the peer response below minimum
      } else if (currentPeer !== null && parseInt(currentPeer.getExpires(), 10) < Number(new Date())) {
        this._logger.info(`waypoint headers above timestamp threshold <- expirations ${currentPeer.getExpires()} current time ${Number(new Date())}`);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'pending');
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerdata`, 'pending');
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerevents`, []);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerheader`, 'running');
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, 1);
        await this.processPeerEvaluations();
        return;
      }
    }
    /// BLOCK COLLIDER ///////////////////////////////////////////////////////
    //
    //    MESSAGES.BLOCK
    //
    //    Peer sent block
    //
    /// ///////////////////////////////////////////////////////
    if (type === MESSAGES.BLOCK) {
      const address = conn.remoteAddress + ':' + conn.remotePort;
      let newPeerAssigned = false;
      let alreadyAnnounced = false;
      // determine if we are evaluating peer performance, if true do not put block and increment peer timer
      const rawBlock = str.slice(10);
      const block = BcBlock.deserializeBinary(rawBlock);
      const index = `${BC_SUPER_COLLIDER}.index.${block.getHash()}`;

      if (!block || !block.getHeight || !block.getHash) {
        return;
      }

      if (BC_BIND_PEER && addressToHost(address) !== BC_BIND_PEER) {
        this._logger.info(`waypoint ${address} ignoring peer, bound to ${BC_BIND_PEER}`);
        return;
      }

      if (PEER_BLACKLIST.indexOf(addressToHost(address)) > -1) {
        // LDL
        debug(`waypoint ${address} in BLACKLIST and attempted to send BLOCK`);
        return;
      }

      if (PEER_QUARANTINE.indexOf(addressToHost(address)) > -1) {
        // LDL
        debug(`waypoint ${address} in quarantine and attempted to send BLOCK`);
        return;
      }

      // block hash has not been seen and its not the genesis block
      if (!SEEN_BLOCKS_MEMORY[block.getHash()] && parseInt(block.getHeight(), 10) !== 1) {

        SEEN_BLOCKS_MEMORY[block.getHash()] = 1;
        SEEN_BLOCKS_MEMORY[parseInt(block.getHeight(), 10)] = 1;
        this._logger.info(`[] <- NRG BLOCK ${block.getHeight()} : ${block.getHash()}`);
        // LDL
        // this._logger.info(`[] <- NRG BLOCK ${block.getHeight()} : ${block.getHash()} from ${addressToHost(address)}`)
      } else {
        return;
      }

      const synced = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
      const reorgBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
      // if there is a higher block respond with latest which initiates an invitation to sync
      if (this._engine._knownFullBlocksCache && this._engine._knownFullBlocksCache.has(block.getHash()) && parseInt(block.getHeight(), 10) > 1) {
        debug(`block ${block.getHeight()} already seen`);
        return;
      }

      if (parseInt(block.getHeight(), 10) > 1) {
        let seenBlock = await this._engine.persistence.get(index);
        if (seenBlock) {
          debug(`BLOCK ${block.getHeight()} is known : ${block.getHash()}`);
          return;
        } else {
          await this._engine.persistence.put(index, `${BC_SUPER_COLLIDER}.block.${block.getHash()}`);
        }
      }

      if (this._engine._knownBlocksCache && this._engine._knownBlocksCache.has(block.getHash()) && parseInt(block.getHeight(), 10) > 1) {
        debug(`block ${block.getHeight()} already seen`);
        return;
      }

      this._noDoubleSent.set(addressToHost(address) + block.getHash(), 1);

      // if an IPHT has not been conducted test the same block was sent by N unique peers X times
      //const isIPHTcomplete = await this.ipht(block, addressToHost(address))
      //if (!isIPHTcomplete) {
      //  this._logger.info(`pending block header evaluations`)
      //  return
      //}

      const ipd = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeerdata`);
      if (iph === 'running' && ipd === 'pending') {
        const inc = await this._engine.persistence.inc(`${BC_SUPER_COLLIDER}.sync.initialpeernum`);
        const updateData = {
          address: address,
          timestamp: Number(new Date()),
          type: 'initialpeerheaderEnd',
          block: block
        };
        await this._engine.persistence.updateList(`${BC_SUPER_COLLIDER}.sync.initialpeerevents`, updateData);
        // if the increment is above quorum check results
        debug(`evaluating increment for block speed ${inc} with BC_USER_QUORUM ${BC_USER_QUORUM}`);
        if (inc >= BC_USER_QUORUM) {
          debug('connection pool is above quorum and ready to initiate waypoint evaluations ');
          const peersEvaluated = await this.processPeerEvaluations();
          if (peersEvaluated === true) {
            debug(`waypoint has been evaluated`);
          }
        }
      } else if (DISABLE_IPH_TEST) {
        let addBlock = false;
        let highestKnownHeight = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
        if (!highestKnownHeight) {
          highestKnownHeight = parseInt(block.getHeight(), 10);
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, highestKnownHeight);
          addBlock = true;
        }
        const latestBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
        if (!latestBlock) {
          addBlock = true;
        }
        const nodeIsSynced = highestKnownHeight && latestBlock && new BN(latestBlock.getHeight()).eq(new BN(highestKnownHeight));
        let currentPeer = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        if (nodeIsSynced || !reorgBlock) {
          debug(`node is considered synced`);
          addBlock = true;
        } else {

          if (currentPeer && addressToHost(currentPeer.getAddress()) !== addressToHost(address)) {
            const time = Number(new Date());
            if (new BN(time).gt(new BN(currentPeer.getExpires()))) {
              // peer expired
              const a = time;
              const b = parseInt(currentPeer.getExpires(), 10);
              const c = a - b;
              this._logger.info(`waypoint request expiration, new assignment created expired by ${c}`);
              currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
              currentPeer.setAddress(addressToHost(address));
              newPeerAssigned = true;
              await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
              if (this._engine.chainState) {
                await this._engine.persistence.reorgBlockchain(BC_SUPER_COLLIDER, { chainState: this._engine.chainState });
              } else {
                await this._engine.persistence.reorgBlockchain(BC_SUPER_COLLIDER);
              }
              addBlock = true;
            } else if (reorgBlock) {
              // ignore the block
              return;
            }
          }
        }

        debug('iph is not running -> emit BC putBlock');
        debug('candidate block ' + block.getHeight() + ' received');
        const options = { fullBlock: true, alreadyAnnounced: false, sendOnFail: false, iph: iph, ipd: ipd, handleAsNewPeer: newPeerAssigned };
        debug(options);

        // only use set immediate after the node has completed initial sync
        if (synced && synced === 'complete') {
          if (SEEN_BLOCKS_MEMORY[parseInt(block.getHeight(), 10)]) {
            process.nextTick(async () => {
              await this._engine.blockFromPeer({ conn: conn, newBlock: block, options: options });
            });
          } else {
            setImmediate(async () => {
              await this._engine.blockFromPeer({ conn: conn, newBlock: block, options: options });
            });
          }
        } else {
          await this._engine.blockFromPeer({ conn: conn, newBlock: block, options: options });
        }
        return;
      } else {

        let highestKnownHeight = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
        if (highestKnownHeight) {
          highestKnownHeight = parseInt(highestKnownHeight, 10);
        } else {
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(block.getHeight(), 10));
        }
        if (highestKnownHeight < parseInt(block.getHeight(), 10)) {
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(block.getHeight(), 10));
        }

        debug('iph is not running -> emit BC putBlock');
        debug('candidate block ' + block.getHeight() + ' received');
        const options = { fullBlock: true, sendOnFail: false, iph: iph, ipd: ipd, handleAsNewPeer: true };
        debug('event->putblock tracing ipd and iph');
        debug(options);
        setImmediate(async () => {
          await this._engine.blockFromPeer({ conn: conn, newBlock: block, options: options });
        });
        // await this._engine.blockFromPeer({conn: conn, newBlock: block, options: options})
      }

      /// OVERLINE ///////////////////////////////////////////////////////
      //
      //    MESSAGES.GET_BLOCK -> Overline
      //
      //    Peer requests block (prioritized recency)
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.GET_BLOCK) {
      const address = conn.remoteAddress + ':' + conn.remotePort;
      debug(`received GET_BLOCK request from waypoint ${address}`);
      const latestBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
      const payload = encodeTypeAndData(MESSAGES.BLOCK, latestBlock);
      const result = await this.qsend(conn, payload);
      if (result.success) {
        debug('successful update sent to waypoint');
      } else {
        this._logger.warn(result);
      }
      /// OVERLINE ///////////////////////////////////////////////////////
      //
      //    MESSAGES.GET_BLOCKS -> Overline
      //
      //    Peer requests block range (prioritized recency)
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.GET_BLOCKS || type === MESSAGES.GET_MULTIVERSE) {
      // if a request is below the latest included the latest block as well.
      const latestBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
      const parts = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]));
      const low = parseInt(parts[0], 10);
      const from = max(2, low - 5);
      const to = min(from + MAX_DATA_RANGE, parseInt(latestBlock.getHeight(), 10));
      this._logger.info(`GET_BLOCKS: retrieving requested blocks from range from: ${from} -> ${to}`);

      const blockList = await this._engine.persistence.getBlocksByRange(from, to, BC_SUPER_COLLIDER, { asBuffer: true });
      if (!blockList || !Array.isArray(blockList)) {
        this._logger.warn(`could not getBlocksByRange(${from}, ${to}) while handling GET_DATA message`);
        return Promise.resolve(false);
      }

      const onlyBlocks = blockList.filter(b => {
        if (b && b.getHeight) {
          return true;
        } else return false;
      });
      if (onlyBlocks.length < 1) {
        this._logger.warn(`no blocks to respond to request for ${from} -> ${to} range`);
        return;
      }
      const payload = encodeTypeAndData(MESSAGES.BLOCKS, onlyBlocks);
      const result = await this.qsend(conn, payload);
      if (result.success === true) {
        debug('successful update sent to waypoint');
      }
      // Peer Sends Challenge Block
    } else if (type === '0011W01') {
      // TODO is this used / sent anywhere? if so add MESSAGES key
      const parts = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]));
      const rawBlock = parts[1];
      const block = BcBlock.deserializeBinary(rawBlock);
      this._engine._emitter.emit('putblock', {
        data: block,
        connection: conn
      });
    } else if (type === '0012W01') {
      // TODO is this used / sent anywhere? if so add MESSAGES key
      const parts = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]));
      const rawBlock = parts[1];
      const block = BcBlock.deserializeBinary(rawBlock);
      const ipd = await this._engine.persistence.get('bc.sync.initialpeerdata');
      this._engine._emitter.emit('putblock', {
        data: block,
        options: {
          sendOnFail: false,
          ipd: ipd,
          iph: iph
        },
        connection: conn
      });
      /// OVERLINE ///////////////////////////////////////////////////////
      //
      //    MESSAGES.GET_HEADER -> Overline
      //
      //    Peer requests header
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.GET_HEADER) {
      const address = conn.remoteAddress + ':' + conn.remotePort;
      debug(`received GET_HEADER request from waypoint ${address}`);
      const latestBlock = await this._engine.persistence.get('bc.block.latest');
      if (!latestBlock) {
        this._logger.warn(`could find '${BC_SUPER_COLLIDER}.block.latest' while handling GET_HEADER message`);
        return Promise.resolve(false);
      }
      latestBlock.clearTxsList();
      const payload = encodeTypeAndData(MESSAGES.HEADER, latestBlock);
      const result = await this.qsend(conn, payload);
      if (result.success && result.allSent) {
        debug('successful update sent to waypoint');
      } else {
        this._logger.warn('header delivery confirmation not available');
      }
      /// OVERLINE ///////////////////////////////////////////////////////
      //
      //    MESSAGES.HEADER
      //
      //    Peer sends header to be evaluated
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.HEADER) {
      const address = conn.remoteAddress + ':' + conn.remotePort;
      this._logger.info(`received HEADER from waypoint ${address}`);
      // peer sending a header
      const parts = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]));
      const rawBlock = parts[1];
      const receivedHeader = BcBlock.deserializeBinary(rawBlock);
      const latestBlock = await this._engine.persistence.get('bc.block.latest');
      if (!latestBlock) {
        this._logger.warn(`Could find 'bc.block.latest' while handling HEADER message`);
        return Promise.resolve(false);
      }
      // if latest block is higher than header send missing blocks
      if (new BN(latestBlock.getHeight()).gt(new BN(receivedHeader.getHeight()))) {
        const range = max(2, Math.abs(parseInt(latestBlock.getHeight(), 10) - parseInt(receivedHeader.getHeight(), 10)));
        let from = parseInt(receivedHeader.getHeight(), 10);
        if (from === 1) {
          from = 2;
        }
        // send only up to 1500 blocks (MAX_HEADER_RANGE)
        const to = min(from + MAX_HEADER_RANGE, from + range);
        debug(`headers from: ${from} to: ${to} range: ${range}`);
        const headers = await this._engine.persistence.getBlocksByRange(from, to, BC_SUPER_COLLIDER, {
          asBuffer: true,
          asHeader: false
        });
        debug(`sending ${address} ${headers.length} headers from: ${from} to: ${to} range: ${range}`);
        const payload = encodeTypeAndData(MESSAGES.HEADERS, headers);
        const result = await this.qsend(conn, payload);
        if (result.success) {
          this._logger.info(`sent waypoint ${headers.length} headers from: ${from} to: ${to} range: ${range}`);
        } else {
          this._logger.error(result);
        }
      }
      /// OVERLINE ///////////////////////////////////////////////////////
      //
      //    MESSAGES.GET_HEADERS -> Overline
      //
      //    Peer requests range of headers
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.GET_HEADERS) {
      const address = conn.remoteAddress + ':' + conn.remotePort;
      debug(`received GET_HEADERS request from waypoint ${address}`);
      // message shape 'GET_HEADERS[*]<blockchain>[*]<from>[*]<to>
      const parts = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]));
      let [, blockchain, _from, _to] = parts;
      let from = Number(_from);
      if (from > 2) {
        // padd from the from address with an additional block
        from = from - 1;
      }
      let to = Number(_to);
      if (to <= 0) {
        const latest = await this._engine.persistence.get('bc.block.latest');
        if (!latest) {
          this._logger.warn(`Could find 'bc.block.latest' while handling GET_HEADERS message to <= 0 branch`);
          return Promise.resolve(false);
        }
        to = latest.getHeight();
      }
      const diff = to - from;
      const sendable = blockchain === BC_SUPER_COLLIDER;
      // check if the header range requested is below limit and assert the send blockchain type is approved
      if (diff > 0 && diff < MAX_HEADER_RANGE + 1 && STRICT_SEND_BC === sendable) {
        const headers = await this._engine.persistence.getBlocksByRange(from, to, blockchain, {
          asBuffer: true,
          asHeader: false
        });
        // send block headers
        const payload = encodeTypeAndData(MESSAGES.HEADERS, headers);
        const result = await this.qsend(conn, payload);
        if (result.success && result.allSent) {
          debug('successful update sent to waypoint');
        }
      }
      /// OVERLINE ///////////////////////////////////////////////////////
      //
      //    MESSAGES.HEADERS
      //
      //    Peer sends headers to be evaluated
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.HEADERS) {
      const address = conn.remoteAddress + ':' + conn.remotePort;
      const currentPeer = await this._engine.persistence.get('bc.sync.initialpeer');
      this._logger.info(`received HEADERS from waypoint ${address}`);
      // message shape 'HEADERS[*]<headers>
      // if headers < 2000 || last header === current latest we know we have reached the edge of the peer's chain
      const [, ...rawHeaders] = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]));
      const unsortedHeaders = rawHeaders.map(h => BcBlock.deserializeBinary(h));
      debug(`headers received ${unsortedHeaders.length}`);
      const headers = unsortedHeaders.sort((a, b) => {
        if (parseInt(a.getHeight(), 10) > parseInt(b.getHeight(), 10)) {
          return 1;
        }
        if (parseInt(a.getHeight(), 10) < parseInt(b.getHeight(), 10)) {
          return -1;
        }
        return 0;
      });
      debug(`headers received from waypoint ${headers.length}`);
      // const validSequence = validateBlockSequence(headers)
      // Validate sequence of block headers
      if (!currentPeer) {
        debug('currentPeer is not defined');
      }
      // FIX: TODO: reanable valid sequence
      // if (!validSequence) {
      //  debug('headers do not form a valid sequence')
      // }
      let passthrough = 1;
      debug(`connection address ${address} current waypoint address: ${currentPeer.getAddress()}`);
      if (currentPeer && passthrough === 1 && addressToHost(currentPeer.getAddress()) === addressToHost(address)) {
        const ipd = await this._engine.persistence.get('bc.sync.initialpeerdata');
        const iph = await this._engine.persistence.get('bc.sync.initialpeerheader');
        const latestBlock = await this._engine.persistence.get('bc.block.latest');
        if (!latestBlock) {
          this._logger.warn(`couldnt find 'bc.block.latest' while handling HEADERS message`);
          return Promise.resolve(false);
        }

        const highestHeader = headers[headers.length - 1];
        // HERE
        debug(`highest waypoint header (${currentPeer.getAddress()}) ${highestHeader.getHeight()} vs local ${latestBlock.getHeight()}`);
        // if the received highest header block is above the latest block request a new set
        for (let i = 0; i < headers.length; i++) {
          //await this._engine.persistence.put(`bc.block.${headers[i].getHeight()}`, headers[i])
          debug(`storing block header ${headers[i].getHeight()}`);
          await this._engine.persistence.putBlock(headers[i]);
        }
        debug(`passthrough on get heights iph: ${iph} ipd: ${ipd}`);
        if (parseInt(latestBlock.getHeight(), 10) < parseInt(highestHeader.getHeight(), 10) && headers.length >= MAX_HEADER_RANGE) {
          // TODO: determine if this needs to run through Multiverse.extendMultiverse
          await this._engine.persistence.putLatestBlock(highestHeader, BC_SUPER_COLLIDER, { chainState: this._engine.chainState });
          // send back the current highest header
          debug(`current waypoint ${currentPeer.getAddress()} successfully submitted headers`);
          currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
          // send back the current highest header
          const msg = encodeTypeAndData(MESSAGES.HEADER, highestHeader);
          debug(`current waypoint ${currentPeer.getAddress()} successfully submitted highest header ${highestHeader.getHeight()}`);
          await this._engine.persistence.put('bc.sync.initialpeer', currentPeer);
          const result = await this.qsend(conn, msg);
          if (result.success) {
            this._logger.info('successful HEADER data sent to waypoint');
          } else {
            this._logger.info(result);
          }
          /*
           * Peer has received all headers
           *   - IPH test is considered complete
           *   - Now going to reset full body TXs
           *   - Could go to any peer, asking for hash range that match the hash range it has on disk
           */
        } else if (ipd === 'pending' && iph !== 'complete' || DISABLE_IPH_TEST === true) {
          // if the header height is equal or greater then the header sync is complete
          // set the current peer sync to the new data boundary
          // TODO: determine if this needs to run through Multiverse.extendMultiverse
          await this._engine.persistence.putLatestBlock(highestHeader, BC_SUPER_COLLIDER, { chainState: this._engine.chainState });
          debug(`current waypoint ${currentPeer.getAddress()} successfully completed header sync -> beginning tx ipd test`);
          await this._engine.persistence.put('bc.sync.initialpeerdata', 'running');
          currentPeer.setExpires(Number(new Date()) + PEER_DATA_SYNC_EXPIRE);
          await this._engine.persistence.put('bc.sync.initialpeer', currentPeer);
          // update the ipd status to running
          await this._engine.persistence.put('bc.sync.initialpeerheader', 'complete');
          // update the ipd status to running
          await this._engine.persistence.put('bc.sync.initialpeernum', 0);
          // reprocess peer evaluations with peer data sync equal to 'running'
          let dataLatestStr = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);
          let latestHeightRaw = 0;
          if (dataLatestStr === null) {
            const now = Date.now();
            await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `2:${now}`);
            latestHeightRaw = 2;
          } else {
            latestHeightRaw = parseInt(dataLatestStr.split(":")[0], 10);
          }

          const reorgFromRaw = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
          if (reorgFromRaw && reorgFromRaw.getHeight && new BN(reorgFromRaw.getHeight()).gt(new BN(latestHeightRaw))) {
            latestHeightRaw = parseInt(reorgFromRaw.getHeight(), 10);
          }

          const latestHeightShifted = parseInt(latestHeightRaw, 10) - 2;
          const latestBlock = await this._engine.persistence.get('bc.block.latest');
          if (!latestBlock) {
            this._logger.warn(`Couldn't get 'bc.block.latest' in processPeerEvaluations`);
            return;
          }
          const from = latestHeightShifted - 5;
          const to = min(latestHeightShifted + MAX_DATA_RANGE, parseInt(latestBlock.getHeight(), 10));
          debug(`IPD status: ${ipd} requesting heights from: ${from} to: ${to}`);
          const fromBlock = await this._engine.persistence.get(`bc.block.${from}`);
          const toBlock = await this._engine.persistence.get(`bc.block.${to}`);
          debug(`fromBlock: ${fromBlock.getHeight()}`);
          debug(`toBlock: ${toBlock.getHeight()}`);
          // the msg contains the from (lowest) block height and to block height (highest)
          const msg = [parseInt(fromBlock.getHeight(), 10), parseInt(toBlock.getHeight(), 10)];
          const payload = encodeTypeAndData(MESSAGES.GET_DATA, msg);
          const result = await this.qsend(conn, payload);
          debug('sent GET_DATA request to connection');
          debug(result);
          if (result.success) {
            this._logger.info('successful data sent to waypoint');
          } else {
            this._logger.info(result);
          }
        }
      }
      /// BLOCK COLLIDER ///////////////////////////////////////////////////////
      //
      //    MESSAGES.GET_DATA
      //
      //    Peer requests get data for tx hashes
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.GET_DATA) {

      const address = conn.remoteAddress + ':' + conn.remotePort;
      debug(`received GET_DATA request from waypoint ${address}`);
      const latestBlock = await this._engine.persistence.get('bc.block.latest');
      const parts = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]));
      const [, ...rawHeights] = parts;
      let high = rawHeights[1];
      let low = rawHeights[0];
      if (high && new BN(high).lt(new BN(low))) {
        low = high;
      }
      debug(`waypoint ${address} RES>GET_DATA request low ${low} -> ${high}`);
      let from = max(2, parseInt(low, 10)); // shift the window by six to confirm overlap
      let to = min(from + 2 * MAX_DATA_RANGE, parseInt(latestBlock.getHeight(), 10) + 1);

      if (from !== to) {
        if (new BN(from).gt(new BN(to))) {
          const hold = from;
          from = to;
          to = hold;
          debug(`GET_DATA request adjusted so assert from ${from} < to ${to} === true`);
        }
      }

      let requestWindow = to - from;

      if (requestWindow < 3) {
        from = max(from - 2, 2);
      }

      const requestWindowNumber = low % 10000;
      const peerKey = `${address}:${requestWindowNumber}`;
      if (!this._requestRegistry[peerKey]) {
        this._requestRegistry[peerKey] = 0;
      }
      this._requestRegistry[peerKey]++;

      if (this._requestRegistry[peerKey] > 1000) {
        PEER_QUARANTINE.push(address);
        this._logger.info(`peer has recieved maximum number of requests in this block window ${requestWindowNumber}`);
        return;
      }

      debug(`M.GET_DATA: getting blocks data from range from: ${from} -> ${to}, request window: ${requestWindow}`);
      let onlyBlocks = [];
      let validBlocks = [];
      // if range request is just one block sen
      if (from === to) {
        this._logger.info(`GET_DATA from ${from} equals to ${to}`);
        const onlyBlock = await this._engine.persistence.getBlocksByHeight(from, BC_SUPER_COLLIDER, {
          asBuffer: true,
          cached: false
        });
        if (onlyBlock) {
          onlyBlocks = onlyBlocks.concat(onlyBlock);
        }
      } else {
        const blockList = await this._engine.persistence.getBlocksByRange(from, to, BC_SUPER_COLLIDER, {
          asBuffer: true,
          cached: true,
          asSet: false
        });
        if (!blockList || !Array.isArray(blockList)) {
          this._logger.warn(`could not getBlocksByRange(${from}, ${to}) while handling RES>GET_DATA message`);
          return Promise.resolve(false);
        }
        onlyBlocks = blockList;
      }

      if (onlyBlocks.length < 1) {
        this._logger.warn(`no blocks to respond to request for ${from} -> ${to} range`);
        return;
      }

      validBlocks = onlyBlocks.filter(b => {
        if (b && b.getTxsList) {
          return b;
        }
      });

      if (validBlocks && validBlocks.length > 0 && validBlocks[validBlocks.length - 1].getHash && validBlocks[validBlocks.length - 1].getHash() === latestBlock.getPreviousHash()) {
        validBlocks.push(latestBlock);
      }

      debug(`sending peer response to RES>GET_DATA final block count ${validBlocks.length}`);

      debug(`GET_DATA requesting confirmed blocks: ${validBlocks.length}`);

      if (validBlocks.length < 1) {
        this._logger.warn(`no blocks to respond to request for ${from} -> ${to} range`);
        return;
      }

      if (parseInt(validBlocks[0].getHeight(), 10) === 1) {
        validBlocks.unshift();
      }

      debug(`sending payload of ${onlyBlocks.length} blocks`);
      const payload = encodeTypeAndData(MESSAGES.DATA, validBlocks);
      const result = await this.qsend(conn, payload);
      if (result && result.success === true) {
        debug(`successful GET_DATA response sent to ${addressToHost(address)} (total: ${onlyBlocks.length}, uploaded: ${validBlocks.length}) from: ${from} to: ${to}`);
      } else {
        debug(`failed GET_DATA response to ${address} from: ${from} to: ${to}`);
      }
      /// BLOCK COLLIDER ///////////////////////////////////////////////////////
      //
      //    MESSAGES.DATA
      //
      //    Peer sends structured data (block and TX, orderbook, FIX)
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.DATA) {
      const rawBlocks = str.slice(10, str.length);
      let blocks = BcBlocks.deserializeBinary(rawBlocks).getBlocksList();
      await this.processDataMessage(conn, blocks, { innerCall: true });
      return;

      /// OVERLINE ///////////////////////////////////////////////////////
      //
      //    MESSAGES.BLOCKS
      //
      //    Peer Sends Block List 0007, used for reorgs and determine reset condition, determine IPD/IPH status
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.BLOCKS) {
      const address = conn.remoteAddress + ':' + conn.remotePort;
      this._logger.info(`received BLOCKS from waypoint ${address}`);
      const parts = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]));
      const [, ...blocks] = parts;
      const latestBlock = await this._engine.persistence.get('bc.block.latest');
      const ipd = await this._engine.persistence.get('bc.sync.initialpeerdata');
      const iph = await this._engine.persistence.get('bc.sync.initialpeerheader');

      // check if the first block claims to be a better branch than the block
      // check if its a valid sequence of blocks

      // if IPD/IPH is 'running' reject the submission
      if (ipd !== 'running' && iph !== 'running' && !DISABLE_IPH_TEST) {
        this._logger.warn(`received blocks range from waypoint ${address} while IPD: ${String(ipd)}`);
        return;
      } else if (ipd !== 'running' && iph !== 'running') {
        this._logger.warn(`would ignore received blocks range from waypoint ${address} while IPD: ${String(ipd)} however DISABLE_IPH_TEST is true`);
      }

      // if not latest block has been assigned reject the range
      if (!latestBlock) {
        this._logger.error(new Error(`cannot find 'bc.block.latest' while handling BLOCKS message from waypoint ${address}`));
        return false;
      }

      // peer cannot send range above the max data/block range
      if (blocks > MAX_DATA_RANGE) {
        this._logger.warn(`${blocks.length} block range from waypoint ${address} exceeded MAX_DATA_RANGE: ${MAX_DATA_RANGE}`);
        return false;
      }

      try {
        let equalBranchHeights = true;
        let localBlock = false;
        const purposedLatestBlock = BcBlock.deserializeBinary(blocks[0]);

        if (!purposedLatestBlock) {
          this._logger.error(`unable to deserialize purposed block ${purposedLatestBlock.getHeight()}`);
          return;
        }

        if (new BN(purposedLatestBlock.getHeight()).cmp(new BN(latestBlock.getHeight())) === 0) {
          localBlock = latestBlock;
        } else {
          // it means additional blocks may have been added
          equalBranchHeights = false;
          localBlock = await this._engine.persistence.get(`bc.block.${parseInt(purposedLatestBlock.getHeight(), 10)}`);
        }

        if (!localBlock) {
          this._logger.warn(`unable to evaluate purposed branch without local reference block ${purposedLatestBlock.getHeight()}`);
          return;
        }

        // conduct edge elect test
        //   - block has more total difficulty
        //   - block has the same or more child heights
        let isLatestBlockElect = true;

        if (isLatestBlockElect) {
          if (!equalBranchHeights) {
            this._logger.warn(`new blocks have been since added after purposed latest block height: ${purposedLatestBlock.getHeight()}`);
            // request a new block in order to trigger a resync on it
            const payload = encodeTypeAndData(MESSAGES.GET_BLOCK, []);
            const sent = await this.qsend(conn, payload);
            if (sent !== undefined) {
              this._logger.info(`GET_BLOCK sent: ${sent}`);
            } else {
              this._logger.error(new Error(`waypoint unable t : ${purposedLatestBlock.getHeight()}`));
            }
            return;
          } else {
            // determine if there is an intersection to rebase on
            const currentHeightSelectHigh = parseInt(blocks[0].getHeight(), 10);
            const currentHeightSelectLow = parseInt(blocks[blocks.length - 1].getHeight(), 10);
            const currentBranch = await this._engine.persistence.getBlocksByRange(currentHeightSelectLow, currentHeightSelectHigh, BC_SUPER_COLLIDER, { asBuffer: true });
            // if there are not enough local blocks switch to IPD/IPH mode
            // this is an extreme edge case likely only if ol coverage lost
            if (!currentBranch || currentBranch.length !== blocks.length) {}
            const intersection = await this.multiverse.getLowestIntersection(currentBranch, blocks);
            if (!intersection) {
              // if there are less than 13 blocks confirm they have more than 200 blocks and request 200 blocks
              if (blocks.length < 13 && new BN(currentHeightSelectHigh).gt(new BN(MAX_DATA_RANGE))) {
                const high = parseInt(blocks[0].getHeight(), 10);
                const low = max(2, high - 200);
                const payload = encodeTypeAndData(MESSAGES.GET_BLOCKS, [low, high]);
                const sent = await this.qsend(conn, payload);
                if (sent !== undefined) {
                  this._logger.info(`GET_BLOCKS sent: ${sent}`);
                } else {
                  this._logger.error(new Error(`waypoint unable t : ${currentHeightSelectHigh}`));
                  return;
                }
              } else if (new BN(currentHeightSelectHigh).lt(new BN(MAX_DATA_RANGE))) {
                this._logger.warn(`purposed branch to low to establish at height: ${currentHeightSelectHigh}`);
                return;
              } else {
                // no intersection found --> trigger a full stop and resync IPD IPH
                // remove current blockchain headers
              }
            } else {
              const purposedIntersectionHeight = parseInt(intersection.getHeight(), 10);
              // intersection has been found --> apply the new blocks and remove the stale sequence
              // 1. Confirm the sequence itself is valid.
              // 2. Emit reorg start signal. Turn off miner.
              // 3. Remove all blocks local blocks at the heights of the purposed sequence
              // 4. Apply changes
              this._logger.info(`waypoint ${address} multiverse change start for block intersection at: ${purposedIntersectionHeight} to ${currentHeightSelectHigh}`);
              const branchFromIntersection = blocks.reduce((all, block) => {
                if (new BN(block.getHeight()).gte(new BN(purposedIntersectionHeight))) {
                  all.push(block);
                }
                return all;
              }, []);
              this._engine._emitter.emit('reorgstart', { data: branchFromIntersection });
              const branchStored = await this.multiverse.addBranch(branchFromIntersection);
              if (!branchStored) {
                // purposed branch was rejected and peer can be ignored
                this._logger.warn(`block branch from waypoint ${address} was invalid`);
                return;
              } else {
                this._logger.info(`block multiverse change successful blocks ${purposedIntersectionHeight} - ${currentHeightSelectHigh}`);
                this._engine._emitter.emit('reorgend', { data: branchFromIntersection });
                return;
              }
            }
          }
        } else {
          // cancel the evaluation of the new blocks
          debug(`purposed branch from waypoint is not improved latest block at height ${parseInt(purposedLatestBlock.getHeight(), 10)}`);
          return;
        }
      } catch (err) {
        this._logger.error(err);
        return;
      }
      // A) Check the first block to determine if it passes the EDGE TEST
      // B) If true check if the sequence is is valid
      // C.1) If true check if the oldest block provided is in the main branch
      // if length < 13 and a common origin cannot be found request 200 blocks
      // if a common origin cannot be found trigger a new IPH and IPD test
      // if a common origin can be found for either stop the miner and rebranch

      let currentHeight = 0;
      let dataLatestStr = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);
      if (dataLatestStr === null) {
        currentHeight = 2;
      } else {
        currentHeight = parseInt(dataLatestStr.split(':')[0], 10);
      }
      let validDataUpdate = true;
      let highestBlock = false;
      this._syncComplete = false;

      for (let i = 0; i < blocks.length; i++) {
        const newBlock = BcBlock.deserializeBinary(blocks[i]);
        const blockHeight = newBlock.getHeight();
        const blockHash = newBlock.getHash();
        // if the block is not defined or corrupt reject the transmission
        debug(`loading newBlock: ${blockHeight}`);
        const block = await this._engine.persistence.get(`bc.block.${blockHash}`);
        if (block === null || newBlock.getHash() !== block.getHash()) {
          // check if the peer simply sent more blocks
          if (block !== null && block !== undefined) {
            debug(`newBlock ${newBlock.getHeight()}:${newBlock.getHash()} vs loaded block ${block.getHeight()}:${block.getHash()}`);
          } else if (block) {
            this._logger.info(`block sent ${newBlock.getHeight()} is an update from waypoint`);
            continue;
          }
        }
        if (validDataUpdate === true && newBlock !== undefined && newBlock !== null) {
          if (new BN(newBlock.getHeight()).toNumber() === this._blockRangeLowerBound.height) {
            this._blockRangeLowerBound.hash = newBlock.getHash();
          } else if (new BN(newBlock.getHeight()).toNumber() === this._blockRangeUpperBound.height) {
            this._blockRangeUpperBound.hash = newBlock.getHash();
          }
          if (parseInt(newBlock.getHeight(), 10) >= parseInt(latestBlock.getHeight(), 10) && parseInt(latestBlock.getHeight(), 10) >= currentHeight) {
            await this._engine.persistence.putLatestBlock(newBlock, BC_SUPER_COLLIDER, { chainState: this._engine.chainState });
          } else {
            const storedBlock = await this._engine.persistence.putBlock(newBlock);
          }
          // if valid set the new height
          if (currentHeight <= parseInt(newBlock.getHeight(), 10)) {
            this._syncComplete = false;
            highestBlock = newBlock;
            currentHeight = parseInt(newBlock.getHeight(), 10);
          }
        }
      }

      const latestBlockHeightFinal = parseInt(latestBlock.getHeight(), 10);

      if (validDataUpdate && currentHeight >= latestBlockHeightFinal) {
        debug(`stored block ${highestBlock.getHeight()} as latest block`);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${currentHeight}:${Date.now()}`);
        const { stored, needsResync, rangeRequest, schedules } = await this._multiverse.extendMultiverse(highestBlock, 'peer', true);
        debug(`waypoint sync stored: ${stored} needs resync: ${needsResync}`);
        if (stored) {
          await this._engine._persistence.putLatestBlock(highestBlock, BC_SUPER_COLLIDER, { chainState: this._engine.chainState });
          this._syncComplete = true;
        }
      }

      this._logger.info(`latestBlock is ${latestBlock.getHeight()} and current height is ${currentHeight}`);
      if (parseInt(latestBlock.getHeight(), 10) === currentHeight && currentHeight >= latestBlockHeightFinal) {
        debug(`the sync is considered complete latestBlock: ${latestBlock.getHeight()} highestCurrent: ${currentHeight} blocks sent: ${blocks.length}`);
        this._syncComplete = true;
      }

      // if peer sends invalid data it is rejected and removed from the peer data
      if (validDataUpdate === false) {
        // reset the best block to the lowest
        this._logger.warn('validDataUpdate === false setting bc.data.latest = 2');
        this._knownBlockSegments.reset();
        const now = Date.now();
        // !! ENABLE TO FULLY RECHECK THE CHAIN FROM ALL PEERS !!
        if (BC_LINKED_SYNC) {
          this._logger.warn(`BC_LINKED_SYNC is true setting new height to ${parseInt(highestBlock.getHeight(), 10) - 200}`);
          //await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${parseInt(highestBlock.getHeight(), 10) - 200}:${now}`)
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `2:${now}`);
        } else {
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `2:${now}`);
        }
        // !!!!!!!!
        // process peer evaluations seeking better candidate
        debug('valid datate update is false requesting waypoint evaluations');
        await this.processPeerEvaluations();
        return;
      } else if (this._syncComplete === false) {
        // update the request to the latest height
        debug(`syncing multichain <- highest height:  ${currentHeight}`);
        const now = Date.now();
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${currentHeight}:${now}`);
        const nextHeight = min(currentHeight + MAX_DATA_RANGE, parseInt(latestBlock.getHeight(), 10));
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${currentHeight}:${now}`);
        debug(`requesting GET_DATA from highestLocalHeight: ${highestBlock.getHeight()} nextHeight for nextHighest: ${nextHeight}`);
        const data = [max(2, parseInt(highestBlock.getHeight(), 10)), nextHeight];
        const payload = encodeTypeAndData(MESSAGES.GET_DATA, data);
        const sent = await this.rsend(address, payload, conn);
        if (sent !== undefined) {
          debug(`GET_DATA sent: ${sent}`);
        } else {
          debug(`GET_DATA request failed: ${sent}`);
        }
        // FIX: here we should likely keep requesting blocks
      } else if (this._syncComplete === true) {
        // START MINER HERE
        debug('if rovers are done syncing the miner can now be initiated');
        await this._engine.persistence.put('bc.sync.initialpeerheader', 'complete');
        await this._engine.persistence.put('bc.sync.initialpeerdata', 'complete');
      } else {
        // get the current best block with data
        const highestBlock = await this._engine.persistence.getBlockByHeight(currentHeight, BC_SUPER_COLLIDER, { asHeader: false });
        //const highestBlock = await this._engine.persistence.getBlockByHeight(currentHeight, BC_SUPER_COLLIDER)
        // get the current best block hash + MAX_DATA_RANGE
        const nextHeight = min(currentHeight + MAX_DATA_RANGE, parseInt(latestBlock.getHeight(), 10));
        let nextHighestBlock = await this._engine.persistence.getBlockByHeight(nextHeight, BC_SUPER_COLLIDER, { asHeader: false });
        //let nextHighestBlock = await this._engine.persistence.getBlockByHeight(nextHeight, BC_SUPER_COLLIDER)
        debug(`highestBlock: ${highestBlock.getHeight()} nextHighestBlock: ${nextHighestBlock}`);
        let data = [max(2, parseInt(highestBlock.getHeight(), 10)), nextHeight];
        //if (!nextHighestBlock) {
        //} else {
        //  data = [ highestBlock.getHeight(), ]
        //}
        const payload = encodeTypeAndData(MESSAGES.GET_DATA, data);
        const sent = await this.rsend(address, payload, conn);
        if (sent !== undefined) {
          debug(`GET_BLOCKS sent: ${sent}`);
        }
      }
      // determine if controller should evaluate block range
      this.setBlockRange();

      /// OVERLINE ///////////////////////////////////////////////////////
      //
      //    MESSAGES.MULTIVERSE
      //
      //    Peer Sends Multiverse 001
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.MULTIVERSE) {
      const ipd = await this._engine.persistence.get('bc.sync.initialpeerdata');
      const address = conn.remoteAddress + ':' + conn.remotePort;
      this._logger.info(`received BLOCKS|MULTIVERSE data from waypoint ${address}`);
      const parts = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]));
      try {
        parts.shift(); // dicard type from the array
        const list = parts.map(rawBlock => BcBlock.deserializeBinary(rawBlock));
        const sorted = list.sort((a, b) => {
          if (a.getHeight() > b.getHeight()) {
            return -1; // move block forward
          }
          if (a.getHeight() < b.getHeight()) {
            return 1; // move block forward
          }
          return 0;
        });

        if (type === MESSAGES.BLOCKS && iph === 'complete' && ipd !== 'pending') {
          this._engine._emitter.emit('putblocklist', {
            data: {
              low: sorted[sorted.length - 1], // lowest block
              high: sorted[0] // highest block
            },
            connection: conn
          });
        } else if (type === MESSAGES.MULTIVERSE && iph === 'complete' && ipd !== 'pending') {
          this._engine._emitter.emit('putmultiverse', {
            data: sorted,
            connection: conn
          });
        }
      } catch (err) {
        this._logger.debug('unable to parse: ' + type + ' from waypoint ');
      }
      /// BLOCK COLLIDER ///////////////////////////////////////////////////////
      //
      //    MESSAGES.TX
      //
      //    Peer Sends TX
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.TX) {
      this._logger.debug('waypoint announced new TX');
      const address = `${conn.remoteAddress}:${conn.remotePort}`;
      const rawTx = str.slice(10);
      const tx = Transaction.deserializeBinary(rawTx);
      this._noDoubleSent.set(addressToHost(address) + tx.getHash(), 1);
      this._logger.debug('received new TX from waypoint');
      await this._engine.processTx(tx, conn);
      /// OVERLINE ///////////////////////////////////////////////////////
      //
      //    MESSAGES.GET_TXS
      //
      //    Peer requests transactions
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.GET_TXS) {
      // message shape 'GET_TXS[*]<dimension>[*]<id>
      const parts = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]));
      const [, rawDimension, rawId] = parts;
      const dimension = JSON.parse(rawDimension);
      const id = JSON.parse(rawId);
      let blocks;
      switch (dimension) {
        case 'hash':
          // get full block with txs by blockHash
          blocks = await this._engine.persistence.getBlockByHash(id, BC_SUPER_COLLIDER);
          break;

        case 'height':
          // get full block with txs by height
          blocks = await this._engine.persistence.getBlocksByHeight(id, BC_SUPER_COLLIDER);
          break;

        default:
          this._logger.debug(`Invalid dimension for GET_TXS: ${dimension}`);
          return Promise.resolve(true);
      }
      // send block with TXs
      const payload = encodeTypeAndData(MESSAGES.TXS, blocks);
      const result = await this.qsend(conn, payload);

      if (result.success && result.allSent) {
        debug('successful update sent to waypoint');
      }
      /// OVERLINE ///////////////////////////////////////////////////////
      //
      //    MESSAGES.TXS
      //
      //    Peer sends transactions
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.TXS) {
      // FIX: type not convertable to Uint8Array
      this._logger.warn('waypoint sent full raw message UNSUPPORTED');
    } else {
      this._logger.info(`Unknown protocol flag received: ${type}`);
    }

    return Promise.resolve(true);
  }

  async broadcastNewBlock(block, withoutPeerId) {
    this._logger.debug(`broadcasting msg to peers, ${inspect(block.toObject())}`);
    let filters = [];
    if (withoutPeerId) {
      if (withoutPeerId.constructor === Array) {
        filters = withoutPeerId;
      } else {
        filters.push(withoutPeerId);
      }
    }
    const reorgBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorg`);
    if (!reorgBlock) {
      this._engine._asyncEmitter.emit('announceblock', { data: block, filters: filters });
    } else {
      this._logger.info(`not announcing block while reorg request is open`);
    }
    return;
  }
}

exports.PeerNode = PeerNode;
exports.default = PeerNode;