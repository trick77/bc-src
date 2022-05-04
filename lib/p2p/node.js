'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

exports.shuffle = shuffle;
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
const { inspect, format: utilFormat } = require('util');

const Url = require('url');
const queue = require('async/queue');
const bufferSplit = require('buffer-split');

const LRUCache = require('lru-cache');
const btoa = require('btoa');
const fetch = require('node-fetch');
const BN = require('bn.js');
const debug = require('debug')('bcnode:p2p:node');
const debugHash = require('debug')('bcnode:p2p:nodehash');
const debugRequest = require('debug')('bcnode:p2p:request');

const framer = require('frame-stream');
const backpressureWriteStream = require('stream-write');
const logging = require('../logger');
const rovers = require('../rover/manager').rovers;
const crypto = require('../script/crypto');
const { MESSAGES, MSG_SEPARATOR, SERVICES } = require('./protocol');
const { encodeTypeAndData, encodeMessageToWire } = require('./codec');
const { contains, find, isEmpty, max, min, values, last } = require('ramda');
const { BcBlock, OutPoint, TransactionInput, TransactionOutput, BlockchainHeader, BlockchainHeaders, Transaction } = require('@overline/proto/proto/core_pb');
const { RoverMessage } = require('@overline/proto/proto/rover_pb');
const { parseBoolean } = require('../utils/config');
const { InitialPeer, BcBlocks, Record, Config, Service } = require('@overline/proto/proto/p2p_pb');
const { Multiverse } = require('../bc/multiverse');
const Discovery = require('./discovery');
const fs = require('fs');
const { getGenesisBlock } = require('../bc/genesis');
const {
  isValidBlock,
  validateTxs,
  validateRequireMountBlock,
  validateCoinbase,
  childrenHeightSum,
  getCoinbaseMissingBlockHeight
} = require('../bc/validation');
const { RpcTransactionResponseStatus } = require('@overline/proto/proto/bc_pb');

const _MAX_FRAME_SIZE = 25 * 1024 * 1024; // 20MB
const BC_OPEN_WAYPOINT = parseBoolean(process.env.BC_OPEN_WAYPOINT);
const FRAMING_OPTS = {
  lengthSize: 4,
  getLength: function (buffer) {
    return buffer.readUInt32BE(0);
  },
  maxSize: _MAX_FRAME_SIZE
};

let saved = 0;

const sortBlockList = blockList => {
  return blockList.sort((a, b) => {

    if (parseInt(a.getHeight(), 10) > parseInt(b.getHeight(), 10)) {
      return 1;
    }

    if (parseInt(b.getHeight(), 10) > parseInt(a.getHeight(), 10)) {
      return -1;
    }

    return 0;
  });
};

const fetchWithTimeout = async (resource, options = {}) => {
  const { timeout = 8000 } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, _extends({}, options, {
    signal: controller.signal
  }));
  clearTimeout(id);
  return response;
};

const getMissingBlock = async (host, hash, persistence) => {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + btoa(':scookie')
  };
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1234,
    method: 'getBlockHash',
    params: [hash]
  });
  return new Promise(async resolve => {
    try {
      fetchWithTimeout(`http://${host}:3000/rpc`, { timeout: 3000, method: "post", headers: headers, body: body }).then(async response => {
        response.json().then(async data => {
          if (data && data.result) {

            const d = data.result;

            const newBlock = new BcBlock();
            const txs = d.txsList.map(tx => {

              const ntx = new Transaction();
              ntx.setVersion(1);
              ntx.setNonce(tx.nonce);
              ntx.setOverline(tx.overline);
              ntx.setNinCount(tx.ninCount);
              ntx.setNoutCount(tx.noutCount);

              const inputs = tx.inputsList.map(input => {

                const outPoint = new OutPoint();
                outPoint.setValue(new Uint8Array(Buffer.from(input.outpoint.value, 'base64')));
                outPoint.setHash(input.outpoint.hash);
                outPoint.setIndex(input.outpoint.index);

                const i = new TransactionInput();
                i.setOutPoint(outPoint);
                i.setInputScript(new Uint8Array(Buffer.from(input.inputScript, 'base64')));
                i.setScriptLength(input.scriptLength);
                return i;
              });

              ntx.setInputsList(inputs);

              const outputs = tx.outputsList.map(output => {
                const o = new TransactionOutput();
                o.setValue(new Uint8Array(Buffer.from(output.value, 'base64')));
                o.setUnit(new Uint8Array(Buffer.from(output.unit, 'base64')));
                o.setScriptLength(output.scriptLength);
                o.setOutputScript(new Uint8Array(Buffer.from(output.outputScript, 'base64')));
                return o;
              });

              ntx.setOutputsList(outputs);
              ntx.setLockTime(tx.locakTime);
              return ntx;
            });
            newBlock.setHash(d.hash);
            newBlock.setPreviousHash(d.previousHash);
            newBlock.setVersion(1);
            newBlock.setSchemaVersion(1);
            newBlock.setHeight(d.height);
            newBlock.setMiner(d.miner);
            newBlock.setDifficulty(d.difficulty);
            newBlock.setMerkleRoot(d.merkleRoot);
            newBlock.setChainRoot(d.chainRoot);
            newBlock.setDistance(d.distance);
            newBlock.setTotalDistance(d.totalDistance);
            newBlock.setNonce(d.nonce);
            newBlock.setNrgGrant(d.nrgGrant);
            newBlock.setTwn(d.twn);
            newBlock.setTwsList([]);
            newBlock.setTxCount(d.txCount);
            newBlock.setTxsList(txs);
            newBlock.setEmblemWeight(d.emblemWeight);
            newBlock.setEmblemChainFingerprintRoot(d.emblemChainFingerprintRoot);
            newBlock.setEmblemChainAddress(d.emblemChainAddress);
            newBlock.setBlockchainHeadersCount(d.newBlockCount);
            newBlock.setBlockchainFingerprintsRoot(d.blockchainFingerprintsRoot);
            newBlock.setTxFeeBase(d.txFeeBase);
            newBlock.setTxDistanceSumLimit(d.txDistanceSumLimit);

            const headers = new BlockchainHeaders();
            const btcList = d.blockchainHeaders.btcList.map(h => {
              const header = new BlockchainHeader();
              header.setBlockchain(h.blockchain);
              header.setHash(h.hash);
              header.setPreviousHash(h.previousHash);
              header.setTimestamp(h.timestamp);
              header.setHeight(h.height);
              header.setMerkleRoot(h.merkleRoot);
              header.setBlockchainConfirmationsInParentCount(h.blockchainConfirmationsInParentCount);
              header.setMarkedTxsList([]);
              header.setMarkedTxCount([]);
              return header;
            });
            const ethList = d.blockchainHeaders.ethList.map(h => {
              const header = new BlockchainHeader();
              header.setBlockchain(h.blockchain);
              header.setHash(h.hash);
              header.setPreviousHash(h.previousHash);
              header.setTimestamp(h.timestamp);
              header.setHeight(h.height);
              header.setMerkleRoot(h.merkleRoot);
              header.setBlockchainConfirmationsInParentCount(h.blockchainConfirmationsInParentCount);
              header.setMarkedTxsList([]);
              header.setMarkedTxCount([]);
              return header;
            });
            const neoList = d.blockchainHeaders.neoList.map(h => {
              const header = new BlockchainHeader();
              header.setBlockchain(h.blockchain);
              header.setHash(h.hash);
              header.setPreviousHash(h.previousHash);
              header.setTimestamp(h.timestamp);
              header.setHeight(h.height);
              header.setMerkleRoot(h.merkleRoot);
              header.setBlockchainConfirmationsInParentCount(h.blockchainConfirmationsInParentCount);
              header.setMarkedTxsList([]);
              header.setMarkedTxCount([]);
              return header;
            });
            const lskList = d.blockchainHeaders.lskList.map(h => {
              const header = new BlockchainHeader();
              header.setBlockchain(h.blockchain);
              header.setHash(h.hash);
              header.setPreviousHash(h.previousHash);
              header.setTimestamp(h.timestamp);
              header.setHeight(h.height);
              header.setMerkleRoot(h.merkleRoot);
              header.setBlockchainConfirmationsInParentCount(h.blockchainConfirmationsInParentCount);
              header.setMarkedTxsList([]);
              header.setMarkedTxCount([]);
              return header;
            });
            const wavList = d.blockchainHeaders.wavList.map(h => {
              const header = new BlockchainHeader();
              header.setBlockchain(h.blockchain);
              header.setHash(h.hash);
              header.setPreviousHash(h.previousHash);
              header.setTimestamp(h.timestamp);
              header.setHeight(h.height);
              header.setMerkleRoot(h.merkleRoot);
              header.setBlockchainConfirmationsInParentCount(h.blockchainConfirmationsInParentCount);
              header.setMarkedTxsList([]);
              header.setMarkedTxCount([]);
              return header;
            });
            headers.setBtcList(btcList);
            headers.setEthList(ethList);
            headers.setNeoList(neoList);
            headers.setLskList(lskList);
            headers.setWavList(wavList);

            newBlock.setBlockchainHeaders(headers);

            if (newBlock && newBlock.getPreviousHash) {
              await persistence.putBlock(newBlock, 0, BC_SUPER_COLLIDER);
              await persistence.saveBlock(newBlock);
            }
            resolve(newBlock);
          }
        }).catch(e => {
          resolve(false);
        });
      }).catch(err => {
        resolve(false);
      });
    } catch (e) {
      resolve(false);
    }
  });
};

const getRandomFromList = list => {
  if (!list || list.length < 1) {
    return false;
  }
  return list[Math.floor(Math.random() * list.length)];
};

const getRandomWithinRange = (min, max) => {
  return Math.floor(Math.random() * (max - min) + min);
};

let PEER_BLACKLIST = process.env.PEER_BLACKLIST && process.env.PEER_BLACKLIST.indexOf('.') > -1 ? process.env.PEER_BLACKLIST.split(',') : [];
let BC_MAX_WAYPOINT_LATENCY = isNaN(process.env.BC_MAX_WAYPOINT_LATENCY) ? 45260 : process.env.BC_MAX_WAYPOINT_LATENCY;
let BC_BIND_PEER = process.env.BC_BIND_PEER !== 'false' ? process.env.BC_BIND_PEER : false;
let WAYPOINT_TIMES = [];
let logline = false;

const BC_MINER_BOOT = parseBoolean(process.env.BC_MINER_BOOT); // initialize new super collider
const BC_MINIMUM_HEADER_TEST = isNaN(process.env.BC_MINIMUM_HEADER_TEST) ? 2 : Number.parseInt(process.env.BC_MINIMUM_HEADER_TEST, 10);
const BC_LOG_WAYPOINT_RECORD = !!(process.env.BC_LOG_WAYPOINT_RECORD && process.env.BC_LOG_WAYPOINT_RECORD !== 'false');
const BC_MINER_POOL = process.env.BC_MINER_POOL && process.env.BC_MINER_POOL.indexOf('.') > -1 ? process.env.BC_MINER_POOL : false;
const BC_ORTHOGONAL_WAYPOINTS = process.env.BC_ORTHOGONAL_WAYPOINTS !== 'false' ? process.env.BC_ORTHOGONAL_WAYPOINTS : false;
const BC_NETWORK = process.env.BC_NETWORK || 'main';
const { networks } = require('../config/networks');
const { config } = require('../config');
const UI_PORT = process.env.BC_UI_PORT && parseInt(process.env.BC_UI_PORT, 10) || config.server.port;
const { quorum, maximumWaypoints, id } = networks[BC_NETWORK];
const SERVICES_SUPPORT_VERSION = 1; // for esablishing Borderless and Overline service layer availability
const BC_CONFIG_VERSION = isNaN(process.env.BC_CONFIG_VERSION) ? id : process.env.BC_CONFIG_VERSION;
const BC_RECORD_VERSION = isNaN(process.env.BC_RECORD_VERSION) ? id + "_" + SERVICES_SUPPORT_VERSION : process.env.BC_RECORD_VERSION;
const BC_SUPER_COLLIDER = process.env.BC_SUPER_COLLIDER ? process.env.BC_SUPER_COLLIDER.toLowerCase() : 'bc';
const BC_BLOODLINE = process.env.BC_BLOODLINE === 'true';
const MIN_HEALTH_NET = process.env.MIN_HEALTH_NET === 'true';
const STRICT_SEND_BC = process.env.STRICT_SEND_BC || true;
const PEER_DATA_SYNC_EXPIRE = 22602; // Peer must return a block / data / network request before time elapsed (milliseconds)
const BC_QUARANTINE_FORGIVENESS = BC_BLOODLINE ? 15000 : getRandomWithinRange(30166, 34900);
const BC_EXTENDED_QUARANTINE_FORGIVENESS = BC_BLOODLINE ? 885000 : getRandomWithinRange(90166, 144900);
const DEFAULT_QUORUM = quorum;
const statWaypointFilePath = process.cwd() + '/waypoint_stats.csv';
const statQuarantineFilePath = process.cwd() + '/quarantine_stats.csv';
const waypointStatStream = parseBoolean(process.env.BC_WAYPOINT_STATS) ? fs.createWriteStream(statWaypointFilePath) : false;
const quarantineStatStream = parseBoolean(process.env.BC_QUARANTINE_STATS) ? fs.createWriteStream(statQuarantineFilePath) : false;
const numCPUs = Number(require('os').cpus().length);
const loadBasedPeerExpiration = logline ? 20000 : 20000 + Math.floor(40000 / numCPUs);
const randomWindows = [9, 5, 30];

/* OVERLINE
 * export const DISABLE_IPH_TEST = parseBoolean(process.env.DISABLE_IPH_TEST) // Used only on testnets, breaks consensus if enabled
 */
const DISABLE_IPH_TEST = exports.DISABLE_IPH_TEST = true;
const BC_PRUNE_DB = exports.BC_PRUNE_DB = parseBoolean(process.env.BC_PRUNE_DB);
const BC_PRUNE_DB_DEPTH = exports.BC_PRUNE_DB_DEPTH = isNaN(process.env.BC_PRUNE_DB_DEPTH) ? 251 : Number(process.env.BC_PRUNE_DB_DEPTH);
const BC_USER_QUORUM = exports.BC_USER_QUORUM = parseInt(process.env.BC_USER_QUORUM, 10) || quorum;
const MAX_HEADER_RANGE = exports.MAX_HEADER_RANGE = Number(process.env.MAX_HEADER_RANGE) || 1000;
const BC_REQUEST_PEERS = exports.BC_REQUEST_PEERS = Number(process.env.BC_REQUEST_PEERS) || 3;
const BC_IPHT_MINIMUM = exports.BC_IPHT_MINIMUM = isNaN(process.env.BC_IPHT_MINIMUM) ? BC_USER_QUORUM : Number(process.env.BC_IPHT_MINIMUM);
const BC_MAX_DATA_RANGE = exports.BC_MAX_DATA_RANGE = Number(process.env.BC_MAX_DATA_RANGE) || 16;
const BC_PEER_CONSENSUS_THRESHOLD = exports.BC_PEER_CONSENSUS_THRESHOLD = Number(process.env.BC_PEER_CONSENSUS_THRESHOLD) || 5;
const BC_MAX_TX_RANGE = exports.BC_MAX_TX_RANGE = Number(process.env.BC_MAX_TX_RANGE) || 1000;
const BC_LINKED_SYNC = exports.BC_LINKED_SYNC = process.env.BC_LINKED_SYNC === 'true';
const BC_PEER_HEADER_SYNC_EXPIRE = exports.BC_PEER_HEADER_SYNC_EXPIRE = Number(process.env.BC_PEER_HEADER_SYNC_EXPIRE) || loadBasedPeerExpiration; // Peer must return a header request before time elapsed (milliseconds)
const BC_MAX_CONNECTIONS = exports.BC_MAX_CONNECTIONS = process.env.BC_MAX_CONNECTIONS || maximumWaypoints;

// blocks which failed
const INVALID_BLOCK_TABLE = {};

const addressToHost = exports.addressToHost = addr => {
  if (!addr) {
    return null;
  }
  let address = addr;
  address = address.replace('::ffff:', '');
  if (address.indexOf(':') > -1) {
    address = address.split(':')[0];
  }

  return address;
};

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

if (BC_BLOODLINE) {
  logline = fs.createWriteStream('bloodline.csv');
}

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
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  constructor(engine) {

    debug('--- NETWORK CONFIG --- \n%O', networks[BC_NETWORK]);
    this._engine = engine;
    this._connectionCount = 0;
    this._syncComplete = true;
    this._blockHeaderTest = [];
    this._childBlocksSynced = 0;
    this._utxoCycles = 0;
    this._processedBlocks = 0;
    this._latestBlock = false;
    this._multiverseCompressions = 0;
    this._knownHashes = [];
    this._SEEN_BLOCKS_MEMORY = {};
    this._PEER_CONSENSUS = {};
    this._PEER_RECORD = {};
    this._txRateLimiter = {};
    this._requestRegistry = {};
    this._connectionRegistry = {};
    this._multiverse = new Multiverse(engine.persistence, engine._txPendingPool, Object.keys(rovers), engine.chainState, engine); /// !important this is a (nonselective) multiverse
    this._logger = logging.getLogger(__filename);
    this._blockRangeUpperBound = false;
    this._blockRangeLowerBound = false;
    this._temporaryBlockStore = {};
    this._BORDERLESS_RPC = [];
    this._PEER_QUARANTINE = [];
    this._PEER_EXTENDED_QUARANTINE = [];
    this._throttle = 0;
    this._highestRequestedRangeHeight = 0;
    this._register = [];
    this._PEER_BLACKLIST = PEER_BLACKLIST; // inherit blacklist from command line
    this._discovery = {
      givenHostName: false
    };
    this._greetingRegister = {};
    this._dataRequestRegister = new LRUCache({
      max: 3000
    });
    this._dataObjectCache = new LRUCache({
      max: 30,
      ttl: getRandomWithinRange(2500, 5900)
    });
    this._knownBlocks = new LRUCache({
      max: 1000
    });
    this._knownBlockSegments = new LRUCache({
      max: 5000
    });
    this._seededPeers = new LRUCache({
      max: 1000
    });
    this._noDoubleSent = new LRUCache({
      max: 1000
    });

    if (waypointStatStream) {
      waypointStatStream.write(`processTime,elapsed,currentHeight,nextHeight,meanElapsed,weightedElapsed,firstBlockProcessedHeight,lastBlockProcessedHeight,meanBlockProcessTime,slowBlockHeight,slowBlockProcessTime,slowBlockChildren,slowBlockDifficulty,slowBlockTxs,slowBlockHeaders,address,slowBlockHash,slowBlockMiner\n`);
    }

    if (quarantineStatStream) {
      quarantineStatStream.write(`timestamp,address,reason,extended\n`);
    }

    this._logger.info(`node waypoint launching with expiration: ${BC_PEER_HEADER_SYNC_EXPIRE} pool: ${BC_MINER_POOL}`);

    setInterval(() => {
      debug(this.getWaypointRecords());
      const sq = this._PEER_QUARANTINE.shift();
      if (sq) {
        debug(`waypoint removed from quarantine: ${sq}, ${this._PEER_QUARANTINE.length} remain in quarantine`);
      } else {
        debug(`${this._PEER_QUARANTINE.length} waypoints in quarantine, ${this._PEER_EXTENDED_QUARANTINE.length} in extended`);
      }
      if (BC_LOG_WAYPOINT_RECORD) {
        console.log(JSON.stringify(this._PEER_RECORD, null, 2));
      }
      if (Object.keys(this._PEER_RECORD).length > 50) {
        const w = Object.keys(this._PEER_RECORD)[Math.floor(Math.random() * Object.keys(this._PEER_RECORD).length)];
        if (BC_LOG_WAYPOINT_RECORD) {
          console.log(`removing random waypoint ${w}`);
        }
      }
    }, BC_QUARANTINE_FORGIVENESS);

    setInterval(() => {
      debug(this.getWaypointRecords());
      const sq = this._PEER_EXTENDED_QUARANTINE.shift();
      if (sq) {
        debug(`waypoint removed from quarantine: ${sq}, ${this._PEER_EXTENDED_QUARANTINE.length} remain in quarantine`);
      } else {
        debug(`${this._PEER_EXTENDED_QUARANTINE.length} waypoints in extended quarantine`);
      }
    }, BC_EXTENDED_QUARANTINE_FORGIVENESS);

    setInterval(async () => {
      let t = BC_MINER_POOL || BC_BIND_PEER;
      const tmp = {};
      if (t) {
        t = t.trim();
        this._PEER_QUARANTINE = this._PEER_QUARANTINE.filter(p => {
          if (p !== t) {
            return p;
          }
        });

        this._PEER_BLACKLIST = this._PEER_BLACKLIST.filter(p => {
          if (p !== t) {
            return p;
          }
        });
      }

      // ensure unique
      this._PEER_QUARANTINE = this._PEER_QUARANTINE.reduce((all, p) => {
        if (all.indexOf(p) < 0) {
          all.push(p);
        }
        return all;
      }, []);

      if (this._PEER_QUARANTINE.length > 0) {
        const currentPeer = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        if (currentPeer && this._PEER_QUARANTINE.indexOf(currentPeer.getAddress()) > -1) {
          await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        }
      }
    }, 2000);

    setInterval(() => {
      const sq = this._PEER_BLACKLIST.shift();
      if (sq) {
        debug(`waypoint removed from blacklist: ${sq}, ${this._PEER_BLACKLIST.length} remain in list`);
      }
    }, getRandomWithinRange(60000 * 1440, 60000 * 1440 * 2));

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
      this._logger.info('waypoints active: ' + this._discovery.connected + ' passive: ' + this._PEER_QUARANTINE.length + ' weight: ' + this._processedBlocks + ' inactive: ' + this._PEER_BLACKLIST.length);
      //this._engine._emitter.emit('peerCount', this._discovery.connected)
      if (this._PEER_QUARANTINE.length > 0) {
        debug('------QUARANTINE------');
        debug(this._PEER_QUARANTINE);
      }
      if (this._PEER_EXTENDED_QUARANTINE.length > 0) {
        debug('------EX. QUARANTINE------');
        debug(this._PEER_EXTENDED_QUARANTINE);
      }
      if (this._PEER_BLACKLIST.length > 0) {
        debug('------BLACKLIST------');
        debug(this._PEER_BLACKLIST);
      }

      const candidates = this._discovery.connections.reduce((all, conn) => {
        const addr = addressToHost(conn.remoteAddress);
        all.push(addr);
        return all;
      }, []);

      debug('------WAYPOINTS------');
      debug(candidates);

      if (this._discovery.connected < BC_USER_QUORUM && MIN_HEALTH_NET !== true) {
        try {
          debug('local client restarting IPH and IPD tests');
          await this._engine.persistence.put('bc.sync.initialpeerdata', 'pending');
          await this._engine.persistence.put('bc.sync.initialpeerheader', 'pending');
          await this._engine.persistence.put('bc.sync.initialpeernum', 0);
          await this._engine.persistence.put('bc.sync.initialpeerevents', []);
          await this._engine.persistence.put('bc.dht.quorum', 0);
        } catch (err) {
          console.trace(err);
          this._logger.error(err);
        }
      }
    }

    setInterval(() => {
      if (this._BORDERLESS_RPC && this._BORDERLESS_RPC.length > 0) {
        const p = getRandomFromList(this._BORDERLESS_RPC);
        this._broadcastUpdate({
          data: {
            borderlessRpc: p
          }
        });
      }
    }, getRandomWithinRange(133000, 378000));

    // monitor peer connection status and resync peer evauations if quorum is lost
    setInterval(statusInterval.bind(this), 40900);
  } // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef
  // eslint-disable-line no-undef

  get multiverse() {
    return this._multiverse;
  }

  set multiverse(multiverse) {
    this._multiverse = multiverse;
  }

  addToQuarantine(addr, reason, extended) {
    if (!addr || !reason) {
      this._logger.warn(`requires address: ${addr} and reason ${reason} to add to quarantine`);
      return false;
    }

    const host = addressToHost(addr);
    if (this._PEER_BLACKLIST.indexOf(host) > -1) {
      this._logger.warn(`cannot ${addr} to quarantine <- "${reason}" (already blacklisted)`);
      return;
    }

    if (this._PEER_RECORD[host]) {
      if (!this._PEER_RECORD[host].quarantined) {
        this._PEER_RECORD[host].lastQuarantineReason = reason;
        this._PEER_RECORD[host].quarantined = 1;
      } else {
        this._PEER_RECORD[host].quarantined++;
      }
    }

    this._PEER_QUARANTINE.splice(this._PEER_QUARANTINE.indexOf(host), 1);
    this._PEER_QUARANTINE.push(host);

    if (extended) {
      this._PEER_EXTENDED_QUARANTINE.splice(this._PEER_QUARANTINE.indexOf(host), 1);
      this._PEER_EXTENDED_QUARANTINE.push(host);
    }
    this._logger.info(`added ${addr} to quarantine <- "${reason}" (extended: ${extended ? true : false}`);

    if (quarantineStatStream) {
      quarantineStatStream.write([Math.floor(new Date() / 1000), host, reason, extended ? 1 : 0].join(',') + '\n');
    }
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

  getWaypointRecords(limit = 3) {
    const l = max(1, limit);
    const range = getRandomWithinRange(300000, 2000000);
    const bound = Date.now() - range;
    const hosts = Object.keys(this._PEER_RECORD);
    let waypoints = hosts.reduce((all, host) => {
      const record = this._PEER_RECORD[host];
      if (record && record.goodBlocks) {
        if (record.lastSeen) {
          if (record.lastSeen > bound && record.goodBlocks >= l) {
            all.push(host);
          }
        }
      }
      return all;
    }, []);

    // if there are waypoints sort them
    if (waypoints.length > 0) {

      // attempt to sort by bandwidth (highest seen)
      if (waypoints.length > 4) {
        const s = [];

        // create weight based on unique blocks delivered first and heartbeat
        for (let w of waypoints) {
          s.push([w, this._PEER_RECORD[w].lastSeen + this._PEER_RECORD[w].goodBlocks]);
        }

        const waypointsSorted = s.sort((a, b) => {
          return b[1] - a[1];
        });

        // return only the top 3 potential waypoints
        return waypointsSorted.map(a => {
          return a[0];
        }).slice(0, 5);
      }

      return waypoints;
    }

    // otherwise return hosts
    return hosts;
  }

  /*
   * sends orthogonal request to random waypoint that is not within quarantine or blacklist
   */
  async findBlockRange(from, to) {

    // prevents inaccurate analyses of the time used
    WAYPOINT_TIMES.length = 0;

    const candidates = this._discovery.connections.reduce((all, conn) => {
      const addr = addressToHost(conn.remoteAddress);
      if (this._PEER_QUARANTINE.indexOf(addr) < 0 && this._PEER_BLACKLIST.indexOf(addr) < 0) {
        all.push(addr);
      }
      return all;
    }, []);

    if (candidates.length < BC_USER_QUORUM) {
      this._logger.warn(`unable to find block range ${from} -> ${to} -> candidates (${candidates.length}) for orthogonal discovery below quorum (${BC_USER_QUORUM})`);
      return;
    }

    const index = getRandomWithinRange(1, candidates.length) - 1;
    for (let waypoint of this._discovery.connections) {
      const addr = addressToHost(waypoint.remoteAddress);
      if (candidates[index] === addr) {
        const data = [from, to];
        const payload = encodeTypeAndData(MESSAGES.GET_DATA, data);
        const cp = new InitialPeer();
        cp.setAddress(addr);
        cp.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, cp);
        const sent = await this.qsend(waypoint, payload);
        if (sent !== undefined && sent.success) {
          // LDL
          this._logger.info(`orthogonal query ${from} -> ${to} sent to ${sent.address}`);
        } else {
          // LDL
          debug(`GET_DATA request yielded from ${address}`);
          debug(`PQ WARNING: 18 for ${addressToHost(address)}`);
          this._PEER_QUARANTINE.unshift(addressToHost(address));
        }
        break;
      }
    }
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
      return Promise.resolve({ sucess: false, message: `requested connection ${address} is unavailable` });
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
        if (sent && sent.success) {
          clearTimeout(qTimeout);
          return sent;
        } else if (retry) {
          setTimeout(() => {
            return cycle();
          }, 100);
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
          debug(`qsend(): wrote ${wireData.length}b to ${conn.remoteAddress}:${conn.remotePort}`);
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
          latestHeightRaw = dataLatestStr.split(':')[0];
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
        // assign initial sync peer
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
      if (parseInt(lastBlock.getHeight(), 10) > highestKnownHeight - BC_MAX_DATA_RANGE) {
        // requre the last 100 blocks or x2 to the highest known hight to be reprocessed
        return false;
      }
    }

    const localFirstBlock = await this._engine.persistence.getBlockByHash(firstBlock.getHash(), BC_SUPER_COLLIDER, {
      asHeader: true,
      cached: true
    });
    const localLastBlock = await this._engine.persistence.getBlockByHash(lastBlock.getHash(), BC_SUPER_COLLIDER, {
      asHeader: true,
      cached: true
    });
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
          if (this._PEER_QUARANTINE.indexOf(address) > -1) {
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
    if (BC_MINER_POOL) {
      this._logger.info(`received DATA from waypoint ${address}`);
    }

    if (this._PEER_QUARANTINE.indexOf(addressToHost(address)) > -1 && addressToHost(address) !== BC_BIND_PEER) {
      debug(`waypoint ${address} in quarantine and attempted to send DATA consider adding to blacklist`);
      return;
    }

    if (this._PEER_BLACKLIST.indexOf(addressToHost(address)) > -1) {
      debug(`waypoint ${address} in BLACKLIST and attempted to send DATA`);
      return;
    }

    const latestBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
    const lowestBlock = blocks[0];
    const reorgBlockRaw = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
    const syncedBeforeData = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
    const now = Date.now();
    const nowEpoch = Math.floor(Date.now() / 1000);
    const peerExpired = false;
    const completeBlockList = [];
    let highestKnownHeight = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
    let currentPeer = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
    let waypointRequest = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.req.range`);

    if (!waypointRequest) {
      this._logger.warn(`no range request made`);
      this.addToQuarantine(address, 'waypoint sent range when no range request made');
      if (logline) {
        logline.write(addressToHost(address) + '\n');
      }
      return;
    }

    const waypointRequestParts = waypointRequest.split(':');

    let waypointRequestHigh = parseInt(waypointRequestParts[0], 10);
    let waypointRequestLow = parseInt(waypointRequestParts[1], 10);
    let waypointRequestTime = parseInt(waypointRequestParts[2], 10);
    let waypointRequestAddress = waypointRequestParts[3];

    let elapsed = 0;
    let meanTime = 0;
    let weightedTime = 0;
    let variance = 0;

    if (!currentPeer) {
      const reorgBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
      if (reorgBlock && !opts.innerCall && !BC_MINER_POOL) {
        debug(`target block found setting new waypoint with request in place...`);
        currentPeer = new InitialPeer();
        currentPeer.setAddress(addressToHost(address));
        currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
      } else if (!opts.innerCall) {
        debug(`DATA from unset new waypoint with request in place, yielding request`);
        debug(`blocks contained: ${blocks[0].getHeight()} -> ${blocks[blocks.length - 1].getHeight()}`);
        this._logger.info(`Unset DATA assigned to initial waypoint`);
        currentPeer = new InitialPeer();
        currentPeer.setAddress(addressToHost(address));
        currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
        //return
        //} else {
        //  return
        //}
      } else if (BC_MINER_POOL) {
        this._logger.info(`BC_MINER_POOL=true, setting new waypoint with request in place...`);
        currentPeer = new InitialPeer();
        currentPeer.setAddress(addressToHost(address));
        currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
      } else {
        return;
      }
    } else if (currentPeer.setExpires && addressToHost(currentPeer.getAddress()) === addressToHost(address) && !opts.innerCall) {
      elapsed = max(0, now - (parseInt(currentPeer.getExpires(), 10) - BC_PEER_HEADER_SYNC_EXPIRE));
      currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
      if (parseInt(blocks[0].getHeight(), 10) > 25) {
        WAYPOINT_TIMES.push(elapsed);
        if (WAYPOINT_TIMES.length > 36) {
          meanTime = WAYPOINT_TIMES.reduce((s, t) => {
            if (t && !isNaN(t)) {
              s = s + t;
            }
            return s;
          }, 0);
          meanTime = Math.floor(meanTime / WAYPOINT_TIMES.length);
          WAYPOINT_TIMES.shift();
        }
      }
    } else if (addressToHost(currentPeer.getAddress()) !== addressToHost(address)) {
      if (blocks && blocks[0] && reorgBlockRaw && new BN(reorgBlockRaw.getHeight()).lte(new BN(blocks[0].getHeight())) && syncedBeforeData && syncedBeforeData === 'complete') {
        debug(`returning DATA from new waypoint`);
        return;
      } else {
        debug(`DATA from unset new waypoint`);
        if (new Date() > parseInt(currentPeer.getExpires(), 10) || syncedBeforeData && syncedBeforeData === 'pending' && !currentPeer) {
          currentPeer = new InitialPeer();
          currentPeer.setAddress(addressToHost(address));
          currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
        } else if (syncedBeforeData === 'complete') {
          debug(`DATA from unset new waypoint <- returning ${addressToHost(address)}`);
          return;
        }
      }
    } else {
      debug(`inner call ${address} <- no expiration set`);
    }

    if (currentPeer && currentPeer.getExpires && new BN(currentPeer.getExpires()).lt(new BN(now))) {
      await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      currentPeer = null;
    }

    if (!currentPeer && !DISABLE_IPH_TEST) {
      this._logger.warn(`cannot fetch waypoint while handling DATA message`);
      return false;
    } else if (!currentPeer && DISABLE_IPH_TEST) {
      currentPeer = new InitialPeer();
      currentPeer.setAddress(addressToHost(address));
      currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
      this._logger.warn(`current waypoint not available, set to ${address}`);
    }

    if (currentPeer && currentPeer.getAddress && addressToHost(currentPeer.getAddress()) !== addressToHost(address)) {
      this._logger.warn('waypoint has not expired');
      //if (this._PEER_QUARANTINE.indexOf(addressToHost(address)) < 0) {
      //  this._PEER_QUARANTINE.push(addressToHost(address))
      //}
      return;
    }

    /* begin sanity check */
    if (blocks && blocks.length > 0) {
      // LDL
      debug(`MESSAGES.DATA received [] <- ${blocks.length} blocks`);

      // CHECK 1 blocks sent //////////////////
      // sort the blocks
      blocks = sortBlockList(blocks);

      if (blocks.length > 55) {
        debug(`waypoint sent block range above maximum 55`);
      }

      // CHECK 2 blocks are within range /////////////////
      const startGivenBlock = blocks[0];
      const startGivenBlockHeight = parseInt(startGivenBlock.getHeight(), 10);
      const endGivenBlock = blocks[blocks.length - 1];
      const endGivenBlockHeight = parseInt(endGivenBlock.getHeight(), 10);

      if (startGivenBlockHeight > waypointRequestLow + BC_MAX_DATA_RANGE * 20) {
        this._logger.warn(`start given height ${startGivenBlockHeight} ABOVE maximum range ${BC_MAX_DATA_RANGE * 10}`);
        this.addToQuarantine(address, `waypoint responded with block range higher than requested start: ${startGivenBlockHeight} requested: ${waypointRequestLow}`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
        if (waypointRequestHigh && waypointRequestLow) {
          this._engine._emitter.emit('requestBlockRange', [waypointRequestHigh, waypointRequestLow]);
        }
        return;
      }

      if (startGivenBlockHeight < waypointRequestLow - BC_MAX_DATA_RANGE * 2) {
        debug(`start given height ${startGivenBlockHeight} BELOW maximum range ${BC_MAX_DATA_RANGE * 8}`);
        this.addToQuarantine(address, `waypoint responded with block range lower than requested: ${waypointRequestLow} given: ${startGivenBlockHeight}`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
        if (waypointRequestHigh && waypointRequestLow) {
          this._engine._emitter.emit('requestBlockRange', [waypointRequestHigh, waypointRequestLow], 3);
        }
        return;
      }

      if (endGivenBlockHeight > waypointRequestHigh + BC_MAX_DATA_RANGE * 10) {
        this._logger.warn(`end given height ${startGivenBlockHeight} ABOVE maximum range ${BC_MAX_DATA_RANGE * 10}`);
        this.addToQuarantine(address, 'waypoint sent too many blocks in response to range request');
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
        if (waypointRequestHigh && waypointRequestLow) {
          this._engine._emitter.emit('requestBlockRange', [waypointRequestHigh, waypointRequestLow], 3);
        }
        return;
      }

      if (endGivenBlockHeight > waypointRequestHigh + BC_MAX_DATA_RANGE * 10) {
        this._logger.warn(`end given height ${startGivenBlockHeight} ABOVE maximum range ${BC_MAX_DATA_RANGE * 10}`);
        this.addToQuarantine(address, 'given end height above the limit of the range delivered');
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
        if (waypointRequestHigh && waypointRequestLow) {
          this._engine._emitter.emit('requestBlockRange', [waypointRequestHigh, waypointRequestLow], 3);
        }
        return;
      }

      // CHECK 4 time bound /////////////////////
      if (waypointRequestTime + 100 < nowEpoch) {
        this._logger.warn(`end given height ${startGivenBlockHeight} ABOVE maximum range ${BC_MAX_DATA_RANGE * 10}`);
        this.addToQuarantine(address, 'request window lower than requested time');
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        if (logline) {
          logline.write(addressToHost(address) + '\n');
        }
        return;
      }

      debug(`processing ${blocks.length} with variance ${variance} from waypoint -> ${completeBlockList.length}`);
    } else {
      // LDL
      debug(`MESSAGES.DATA received from waypoint with malformed blocks`);
      this.addToQuarantine(address, 'MESSAGES.DATA received from waypoint with malformed blocks');
      await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
      if (logline) {
        logline.write(addressToHost(address) + '\n');
      }
      return;
    }

    if (!latestBlock) {
      this._logger.warn(`cannot find 'bc.block.latest' while handling DATA message`);
      return false;
    }

    if (highestKnownHeight) {
      highestKnownHeight = parseInt(highestKnownHeight, 10);
    }

    let dataLatestStr = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);
    let latestHeightRaw = 0;
    if (dataLatestStr === null) {
      const now = Date.now();
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${lowestBlock.getHeight()}:${now}`);
      latestHeightRaw = 2;
    } else {
      latestHeightRaw = parseInt(dataLatestStr.split(':')[0], 10);
    }

    if (reorgBlockRaw && new BN(reorgBlockRaw.getHeight()).gt(new BN(latestHeightRaw))) {
      latestHeightRaw = parseInt(reorgBlockRaw.getHeight(), 10);
    }

    this._syncComplete = false;

    const innerCallBlocks = [].concat(blocks);
    const requestWindowNumber = parseInt(lowestBlock.getHeight(), 10) % 10000;
    const peerKey = `${address}:${requestWindowNumber}`;
    if (!this._requestRegistry[peerKey]) {
      this._requestRegistry[peerKey] = 0;
    }
    this._requestRegistry[peerKey]++;

    if (this._requestRegistry[peerKey] > 1500) {
      debug(`PQ WARNING: 15 for ${addressToHost(address)}`);
      this.addToQuarantine(address, 'PQ WARNING: 15 "more than 1500 requests"');
      this._logger.info(`peer has recieved maximum number of requests in this block window ${requestWindowNumber}`);
      return;
    }

    const startProcessTime = Date.now();
    const latestHeightRawBoundary = latestHeightRaw + 100 * BC_MAX_DATA_RANGE;
    const reorgFromBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
    const reqRange = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.req.range`);
    let reqHeight = false;
    if (reqRange && reqRange.indexOf(':') > -1) {
      reqHeight = reqRange.split(":")[0];
    }

    let lowestHeightRawBoundary = reorgFromBlock && reorgFromBlock.getHeight ? parseInt(reorgFromBlock.getHeight(), 10) - 19000 : latestHeightRaw - 19000;
    if (reqHeight) {
      this._logger.info(`range request scanning for block range detected ${lowestHeightRawBoundary} -> ${reqHeight - 200}`);
      lowestHeightRawBoundary = reqHeight - 200;
    }

    const lowestBoundaryBlocks = [];
    const previousBlockTable = {};
    let finalInvalidBlocks = [];
    let finalValidBlocks = [];
    let invalidBlockHeights = [];
    let validBlockHeights = [];
    let blocksLoadedFromMemory = 0;
    let segmentUnlinked = false;
    let segmentAlreadyProcessed = false;
    let lowestBoundary = false;
    let blocksProvidedOutsideBoundary = false;
    let brokenSegment = false;
    let validDataUpdate = true;
    let currentHeight = latestHeightRaw;
    let highestBlock = false;
    let blocksLength = blocks.length;
    let checkBoundaries = false;
    let highestBoundary = false;
    let invalidData = false;
    let validBlocks = 0;
    let scheduledForNextTick = false;
    let minimumValidBlocks = max(0, min(blocks.length - 4, BC_MAX_DATA_RANGE) - 3);
    let reviewBlockHashes = [];
    let goldlings = 0;
    let segmentKey = false;
    let mountBlockFound = false;
    let highestBlockInQueue = false;
    let genesisBlockInData = false;
    let syncProgress = 0;
    let syncThrottleMS = 100;
    let syncLookBack = 1;
    let syncLookAhead = 1;
    let meanBlockProcessTime = 0;
    let processTime = 0;
    let processTimes = [];
    let pendingBlocks = [];
    let unseenBlocks = 0;
    let processTimeElapsed = false;
    let firstBlockProcessed = false;
    let lastBlockProcessed = false;
    let lastBlock = false;
    let sequenceFailed = false;
    let checkCoinbaseBlock = false;
    let flag = false;
    let searchWaypointLower = false;
    const uniqueBlockQueueHashes = {};
    let blockQueue = blocks.reduce((all, b) => {

      // filter out malformed blocks
      if (!b || !b.getHash) {
        return all;
      }

      if (all.length < 1) {
        all.push(b);
      } else {
        if (parseInt(all[all.length - 1].getHeight(), 10) + 1 === parseInt(b.getHeight(), 10)) {
          all.push(b);
        } else if (parseInt(all[all.length - 1].getHeight(), 10) === parseInt(b.getHeight(), 10)) {
          all.push(b);
        }
      }
      return all;
    }, []);

    if (blockQueue.length !== blocks.length) {
      debug(`waypoint delivered blocks out of segment received: ${blocks.length}, accepted: ${blockQueue.length}`);
    }

    // ensure block is unique
    blockQueue = blockQueue.reduce((all, b) => {

      if (uniqueBlockQueueHashes[b.getHash()]) {
        return all;
      }

      uniqueBlockQueueHashes[b.getHash()] = true;
      all.push(b);

      return all;
    }, []);

    if (blockQueue.length > 0) {
      segmentKey = `${address}${blockQueue.length}${blockQueue[0].getHash()}${blockQueue[blockQueue.length - 1].getHash()}`;
      if (this._knownBlockSegments.has(segmentKey) || blockQueue.length === 1) {
        this._logger.info(`segment is already processed: ${segmentKey} of queue length ${blockQueue.length}`);
        segmentAlreadyProcessed = true;
        this.addToQuarantine(address, 'Waypoint sent pre-processed segment in same sync cycle');
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        await this._engine.persistence.reorgBlockchain();
        await this._engine.reorgTxPendingPool();
        this._knownBlockSegments.clear();
        return;
      }
    }

    debug(`blocks received: ${blocksLength}, blocks queued: ${blockQueue.length}, goldlings: ${goldlings} <- current height on local disk is ${currentHeight}`);

    /*
     * 1. Check if segment is known // 1698105
     */
    const utxoCycleLimit = getRandomWithinRange(220, 290);
    let segmentKnown = false;
    let evalBlock = false;
    let forceBreak = false;

    let newQueue = blockQueue.reduce((all, b) => {
      if (this._knownHashes.indexOf(b.getHash()) < 0) {
        debugHash(`havent seen ${b.getHeight()}:${b.getHash()}`);
        all.push(b);
      }
      return all;
    }, []);

    if (newQueue.length <= 4) {
      let seen = true;
      for (let i = 0; i < newQueue.length; i++) {
        let seenBlock = await this._engine._utxoManager.areUTXOsSavedForBlock(newQueue[i].getHeight(), newQueue[i].getHash());
        if (!seenBlock) seen = false;
      }
      if (seen) newQueue = [];
    }

    if (newQueue.length === 0) {
      debug(`block queue seen, minimumValidBlocks = ${minimumValidBlocks}`);
      const newBlock = blockQueue.pop();
      segmentKnown = true;
      highestBlock = newBlock;
      currentHeight = parseInt(newBlock.getHeight(), 10);
      evalBlock = newBlock;
      checkCoinbaseBlock = newBlock;
      // minimumValidBlocks = max(0, (min(newQueue.length - 4, BC_MAX_DATA_RANGE) - 3))
    } else if (newQueue.length > 0) {
      debug(`newQueue = ${newQueue.length}, minimumValidBlocks = ${minimumValidBlocks}`);
      minimumValidBlocks = max(0, min(newQueue.length - 4, BC_MAX_DATA_RANGE) - 3);
      blockQueue = newQueue;
    }

    /*
     * 2. Process all blocks if segment is not know
     */

    do {
      const newBlock = blockQueue.shift();

      if (newBlock && newBlock.getHeight) {
        checkCoinbaseBlock = newBlock;
      }
      if (newBlock && !newBlock.getHeight) {
        console.log({ newBlock });
        break;
      }

      if (parseInt(newBlock.getHeight(), 10) < 2) {
        if (!genesisBlockInData) {
          this._logger.warn(`waypoint sent genesis block which is not expected latest height raw ${latestHeightRawBoundary}`);
          this._PEER_BLACKLIST.push(addressToHost(address));
          if (latestHeightRawBoundary && latestHeightRawBoundary > 5000) {
            blocksProvidedOutsideBoundary = true;
          }
          continue;
        } else {
          this._logger.warn(`waypoint sent multiple genesis blocks which is not expected, blacklisting`);
          this._PEER_BLACKLIST.push(addressToHost(address));
          blocksProvidedOutsideBoundary = true;
          invalidBlockHeights.push(1);
          return;
        }
      }

      if (parseInt(newBlock.getHeight(), 10) > this._highestRequestedRangeHeight) {
        this._highestRequestedRangeHeight = parseInt(newBlock.getHeight(), 10);
      }

      if (lowestHeightRawBoundary && lowestHeightRawBoundary > parseInt(newBlock.getHeight(), 10)) {
        this._logger.warn(`waypoint sent block outside boundary: ${lowestHeightRawBoundary} received ${newBlock.getHeight()}`);
        blocksProvidedOutsideBoundary = true;
      }

      if (!lowestBoundary || lowestBoundary <= parseInt(newBlock.getHeight(), 10)) {
        // the lowest boundary cannot be the genesis block
        if (parseInt(newBlock.getHeight(), 10) > 1) {
          lowestBoundary = parseInt(newBlock.getHeight(), 10);
          lowestBoundaryBlocks.unshift(newBlock);
        }
      } else if (!highestBoundary || highestBoundary > parseInt(newBlock.getHeight(), 10)) {
        highestBoundary = parseInt(newBlock.getHeight(), 10);
      }

      if (scheduledForNextTick) {
        debug(`processing block queue scheduled for next tick`);
        continue;
      }

      const newBlockBoundary = parseInt(newBlock.getHeight(), 10) + BC_MAX_DATA_RANGE + 1;
      let foundRootBlockToMountBranch = false;
      this._temporaryBlockStore[newBlock.getHash()] = newBlock;
      debug(`processing OL block ${newBlock.getHeight()} : ${newBlock.getHash()} of ${blockQueue.length}`);
      // add this to the inbound watch queue
      if (!this._SEEN_BLOCKS_MEMORY[newBlock.getHash()]) {
        this._SEEN_BLOCKS_MEMORY[newBlock.getHash()] = Math.floor(Date.now() / 1000);
      }

      //if (waypointStatStream) {
      //  if (!processTimeElapsed) {
      //    processTimeElapsed = Number(Date.now())
      //    pendingBlocks.push(newBlock)
      //  } else {
      //    const bl = pendingBlocks.pop()
      //    pendingBlocks.push(newBlock)
      //    const newBlockHeaders = bl.getBlockchainHeadersCount ? bl.getBlockchainHeadersCount() : 0
      //    const timeUsed = Date.now() - processTimeElapsed
      //    processTimes.push({
      //      hash: bl.getHash(),
      //      processTime: timeUsed,
      //      txs: bl.getTxsList().length,
      //      height: bl.getHeight(),
      //      difficulty: bl.getDifficulty(),
      //      headers: this._engine._miningOfficer._knownRovers.reduce((all, roverName) => {
      //        const methodNameGet = `get${roverName[0].toUpperCase() + roverName.slice(1)}List`
      //        const l = bl.getBlockchainHeaders()[methodNameGet]().length
      //        all = all + l
      //        return all
      //      }, 0),
      //      newBlocks: newBlockHeaders,
      //      miner: bl.getMiner().slice(2, 64)
      //    })
      //    processTimeElapsed = Number(Date.now())
      //  }
      //}
      // LDL
      debug(`evaluating block ${newBlock.getHeight()}:${highestKnownHeight} ${newBlock.getHash().slice(0, 21)}... boundary: ${latestHeightRawBoundary}, highest: ${highestKnownHeight}`);

      if (this._knownHashes.indexOf(newBlock.getHash()) > -1) {

        if (currentHeight < parseInt(newBlock.getHeight(), 10)) {
          highestBlock = newBlock;
          currentHeight = parseInt(newBlock.getHeight(), 10);
          debug(`new current height ${currentHeight} and sync complete is now false`);
        } else if (!highestBlock) {
          highestBlock = newBlock;
        }

        finalValidBlocks.push(newBlock);
        validBlockHeights.push(parseInt(newBlock.getHeight(), 10));
        blocksLoadedFromMemory++;
        validBlocks++;
        // LDL
        debug(`block loaded from memory: ${newBlock.getHeight()} ${newBlock.getHash()}`);
        if (highestKnownHeight) {
          syncProgress = parseInt(newBlock.getHeight(), 10) / parseInt(highestKnownHeight, 10) * 100;
        }

        if (syncProgress > 100) {
          syncProgress = 100;
        }

        if (syncProgress > 0) {
          const rawSyncProgress = parseFloat(syncProgress).toFixed(4);
          syncProgress = parseFloat(syncProgress).toFixed(2);
          if (rawSyncProgress > 99.999 && syncedBeforeData !== 'pending' && BC_USER_QUORUM === DEFAULT_QUORUM) {
            syncThrottleMS = 150;
            syncLookBack = 1;
            const cbs = newBlock.getBlockchainHeadersCount ? newBlock.getBlockchainHeadersCount() : 0;
            this._childBlocksSynced = this._childBlocksSynced + cbs;
          } else {
            const childBlocks = newBlock.getBlockchainHeadersCount ? newBlock.getBlockchainHeadersCount() : 0;
            this._childBlocksSynced = this._childBlocksSynced + childBlocks;
            // print the log only if new
            if (blockQueue.length === 0) {
              // getBlockchainHeadersCount
              const embPerf = this._engine._emblemPerformance && this._engine._emblemPerformance > 0 ? Math.floor(this._engine._emblemPerformance * 10) : 0;
              const radPower = this._engine._emblemPerformance && this._engine._emblemPerformance > 0 ? Math.floor(this._engine._emblemPerformance * 6757) : 0;
              this._logger.info(`OL #${newBlock.getHeight()}:${highestKnownHeight} (${max(0, Math.abs(this._highestRequestedRangeHeight - parseInt(newBlock.getHeight(), 10)))}) ${this._childBlocksSynced}:${childBlocks} <- ${newBlock.getHash().slice(0, 8)} ${newBlock.getPreviousHash().slice(0, 8)} <- EMB MINING POWER: +${embPerf}% OL (${radPower} RAD/s)`);
            }
          }
        }
        debug(`moving to next block in queue of length ${blockQueue.length}, blocks provided outside boundary: ${blocksProvidedOutsideBoundary}, segment known: ${segmentKnown}, broken segment: ${brokenSegment}`);
        await this._engine.persistence.saveBlock(newBlock);
        continue;
      } else if (blockQueue.length === 0) {
        unseenBlocks++;
        highestBlock = newBlock;
        currentHeight = parseInt(newBlock.getHeight(), 10);
      }

      debug(`storing block ${newBlock.getHeight()}:${highestKnownHeight} ${newBlock.getHash().slice(0, 21)}... boundary: ${latestHeightRawBoundary}, highest: ${highestKnownHeight}`);

      await this._engine.persistence.saveBlock(newBlock);
      const pb = await this._engine.persistence.putBlock(newBlock, 0, BC_SUPER_COLLIDER, {
        asHeader: false,
        fromWaypoint: true,
        saveHeaders: true
      });

      if (!pb) {
        const eb = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.${newBlock.getHash()}`);
        if (!eb) {
          if (invalidBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
            invalidBlockHeights.push(parseInt(newBlock.getHeight(), 10));
          }
          continue;
        }
      }

      await this._engine.persistence.saveBlockHeaders(newBlock);

      if (new BN(newBlock.getHeight()).gt(new BN(latestHeightRawBoundary)) && !new BN(latestHeightRaw).lt(new BN(10))) {
        this._logger.info(`latest block threshold broken: ${newBlock.getHeight()}`);
        blocksProvidedOutsideBoundary = true;
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

      let prevBlock = this._temporaryBlockStore[newBlock.getPreviousHash()] ? this._temporaryBlockStore[newBlock.getPreviousHash()] : await this._engine.persistence.getBlockByHash(newBlock.getPreviousHash(), BC_SUPER_COLLIDER, {
        asHeader: false,
        cached: false
      });

      //wtc.write(`2,${Number(Date.now())}\n`)
      if (!prevBlock) {
        const prevBlockOpts = await this._engine.persistence.getBlocksByHeight(parseInt(newBlock.getHeight(), 10) - 1, BC_SUPER_COLLIDER, {
          asHeader: false,
          cached: false
        });
        //wtc.write(`3,${Number(Date.now())}\n`)
        if (prevBlockOpts) {
          for (let b of prevBlockOpts) {
            if (b.getHash() === newBlock.getPreviousHash()) {
              prevBlock = b;
            }
          }
        }
      }

      if (!prevBlock) {

        prevBlock = await this._engine.persistence.getBlockByHash(newBlock.getPreviousHash(), BC_SUPER_COLLIDER, { cached: true });

        if (!prevBlock) {
          prevBlock = await this._engine.persistence.getBlockByHeight(parseInt(newBlock.getHeight(), 10) - 1, BC_SUPER_COLLIDER, {
            asHeader: false,
            cached: false
          });
        }

        if (prevBlock && prevBlock.getHash() !== newBlock.getPreviousHash()) {
          searchWaypointLower = true;
          this._logger.info(`previous hash unmounted ${newBlock.getPreviousHash()}`);
          prevBlock = false;
        }
      }

      if (prevBlock) {
        this._temporaryBlockStore[prevBlock.getHash()] = prevBlock;
      }

      if (prevBlock && newBlock) {

        //if (newBlock.getHeight() !== 2443713 && newBlock.getHeight() !== 2444712 && newBlock.getHeight() !== 2451598 && newBlock.getHeight() !== 641453 || newBlock.getHeight() > 2500000) {
        // if (newBlock.getHeight() > 2500066) {
        //   if (newBlock.getPreviousHash() === prevBlock.getHash()) {
        //     const prevBlockChildSum = childrenHeightSum(prevBlock)
        //     const newBlockChildSum = childrenHeightSum(newBlock)
        //     if (newBlockChildSum <= prevBlockChildSum) {
        //       const syncedStatus = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`)
        //       this._logger.info(`block pair weight too low ${prevBlockChildSum - newBlockChildSum} <- ${prevBlock.getHeight()} <> ${newBlock.getHeight()}`)
        //       await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`)
        //       if (this._PEER_QUARANTINE.indexOf(addressToHost(address)) < 0) {
        //         this._PEER_QUARANTINE.push(addressToHost(address))
        //       }
        //       if (syncedStatus && syncedStatus !== 'complete') {
        //         await this._engine.persistence.reorgBlockchain()
        //       }
        //       return
        //     }
        //   }
        // }

      }

      if (!prevBlock && newBlockBoundary < highestKnownHeight) {

        let found = false;
        this._logger.info(`pending arrival of local hash: ${parseInt(newBlock.getHeight(), 10) - 1} : ${newBlock.getPreviousHash()} to mount ${parseInt(newBlock.getHeight(), 10)} : ${newBlock.getHash()}`);

        //wtc.write(`4,${Number(Date.now())}\n`)
        const nb = await this._engine.persistence.getBlocksByHeight(parseInt(newBlock.getHeight(), 10) - 1, BC_SUPER_COLLIDER, {
          asHeader: false,
          cached: false
        });
        //wtc.write(`5,${Number(Date.now())}\n`)
        if (nb) {
          for (let b of nb) {

            if (b.getHash() !== newBlock.getHash() && reviewBlockHashes.indexOf(b.getHash()) < 0) {
              await this._engine.persistence.saveBlock(b);
              await this._engine.persistence.putBlock(b, 0, BC_SUPER_COLLIDER, {
                cached: false,
                saveHeaders: true
              });
              reviewBlockHashes.push(b.getHash());
              blockQueue.unshift(b);
              found = true;
            }
          }
        }
        if (!found) {
          const hb = await this._engine.persistence.getBlockByHash(newBlock.getPreviousHash(), BC_SUPER_COLLIDER, {
            asHeader: false,
            cached: false
          });

          if (!hb) {

            if (invalidBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
              invalidBlockHeights.push(parseInt(newBlock.getHeight(), 10) - 1);
            }

            if (invalidBlockHeights.length < 2) {
              searchWaypointLower = true;
            }
          } else {
            found = true;
          }
        }

        if (!found) debug(`found but missing ${BC_SUPER_COLLIDER} block ${blockHeight} : ${newBlock.getHash()}`);

        //if (!found && !opts.innerCall) {
        //  scheduledForNextTick = true
        //  this._PEER_RECORD[addressToHost(address)].lastSeenHash = "NA"
        //  // note that the process data message only sends the latest
        //  this._logger.info(`segment pending arrival to process block ${newBlock.getHeight()} : ${newBlock.getPreviousHash().slice(0, 21)} `)
        //  this._PEER_RECORD[addressToHost(address)].lastSeen = Date.now()
        //  const ind = this._knownHashes.indexOf(newBlock.getHash())
        //  if (ind > -1) { this._knownHashes.splice(ind, 1) }
        //  //wtc.write(`6,${Number(Date.now())}\n`)
        //  await this.processDataMessage(conn, innerCallBlocks, {innerCall: true})

        //} else {
        //  if (invalidBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
        //     invalidBlockHeights.push(parseInt(newBlock.getHeight(), 10))
        //  }
        //}
        if (blockQueue.length > 0 && blockQueue[0].getHeight && parseInt(blockQueue[0].getHeight(), 10) !== parseInt(newBlock.getHeight(), 10)) {
          brokenSegment = true;
        }
        continue;
      }

      if (this._knownHashes.indexOf(blockHash) > -1 && blockHeight <= currentHeight && validBlockHeights.indexOf(blockHeight) < 0) {
        validBlocks++;
        validBlockHeights.push(blockHeight);
        debug(`BLOCK is known ${blockHeight} : ${blockHash} `);
        if (!lowestBoundary || lowestBoundary <= parseInt(newBlock.getHeight(), 10)) {
          // the lowest boundary cannot be the genesis block
          if (parseInt(newBlock.getHeight(), 10) > 1) {
            lowestBoundary = parseInt(newBlock.getHeight(), 10);
            lowestBoundaryBlocks.unshift(newBlock);
          }
        } else if (!highestBoundary || highestBoundary > parseInt(newBlock.getHeight(), 10)) {
          highestBoundary = parseInt(newBlock.getHeight(), 10);
        }
        continue;
      }
      // if the block is not defined or corrupt reject the transmission
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
      //wtc.write(`7,${Number(Date.now())}\n`)
      if (block !== null && newBlock.getHash() !== block.getHash()) {
        // check if the peer simply sent more blocks
        this._logger.info(`newBlock ${newBlock.getHeight()}:${newBlock.getHash()} vs loaded block ${block.getHeight()}:${block.getHash()}`);
      }

      if (parseInt(newBlock.getHeight(), 10) === 2) {
        finalValidBlocks.push(newBlock);
        validBlockHeights.push(parseInt(newBlock.getHeight(), 10));
        this._knownHashes.push(blockHash);
        validBlocks++;
        //wtc.write(`8,${Number(Date.now())}\n`)
        continue;
      }

      if (newBlock !== undefined && newBlock !== null && !invalidData && prevBlock && prevBlock.getHeight && parseInt(newBlock.getHeight(), 10) > 1) {
        const sv = isValidBlock(newBlock);
        if (!sv) {
          if (invalidBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
            if (validBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
              invalidBlockHeights.push(parseInt(newBlock.getHeight(), 10));
            }
          }
          // LDL
          this._logger.info(`pending block ${newBlock.getHeight()} after isolated block assertion, waypoint removed from table ${addressToHost(address)}`);
          this.addToQuarantine(address, 'invalid block sent in response to block range request');
          continue;
        }

        this._processedBlocks++;
        const randomBound = getRandomWithinRange(2001, 3001);
        // increment check method
        flag = blockQueue.length === 0 && invalidBlockHeights.length === 0;
        debug(`random bound ${randomBound} ${newBlock.getHeight()}`);
        // segment check method
        debug(`flag bound ${randomBound} ${newBlock.getHeight()}`);
        if (!flag) {
          this._utxoCycles++;
        } else {
          this._utxoCycles = 0;
        }
        debug(`attempt to update coinbase ${newBlock.getHeight()} flag: ${flag}`);

        // remove any detected unmounts
        debug(`valid coinbase ${newBlock.getHeight()}`);

        if (!lowestBoundary || lowestBoundary <= parseInt(newBlock.getHeight(), 10)) {
          // the lowest boundary cannot be the genesis block
          if (parseInt(newBlock.getHeight(), 10) > 1) {
            lowestBoundary = parseInt(newBlock.getHeight(), 10);
            lowestBoundaryBlocks.unshift(newBlock);
          }
        } else if (!highestBoundary || highestBoundary > parseInt(newBlock.getHeight(), 10)) {
          highestBoundary = parseInt(newBlock.getHeight(), 10);
        }

        if (prevBlock) {
          // put the index of the previous block
          await this._engine.persistence.putChildBlocksIndexFromBlock(prevBlock);
          await this._engine.persistence.saveBlockHeaders(prevBlock);
        }

        await this._engine.persistence.putChildBlocksIndexFromBlock(newBlock);
        await this._engine.persistence.saveBlockHeaders(newBlock);

        if (prevBlock && prevBlock.getHeight() !== newBlock.getHeight()) {
          previousBlockTable[prevBlock.getHash()] = prevBlock;

          let isValidSeq = {
            valid: false
          };

          const mountBlockReq = validateRequireMountBlock(newBlock, prevBlock);
          if (mountBlockReq && parseInt(newBlock.getHeight(), 10) > 7599000) {
            this._logger.info(`required block mount of ${mountBlockReq[0].getBlockchain()} ${mountBlockReq[0].getHeight()} <- ${mountBlockReq.length} paths`);
            for (let req of mountBlockReq) {
              if (foundRootBlockToMountBranch) {
                break;
              }
              //wtc.write(`10,${Number(Date.now())}\n`)
              const mountBlocks = await this._engine.persistence.getRootedBlockFromBlock(req, [], { returnParents: true });
              if (mountBlocks) {
                // LDL
                debug(mountBlocks);
                // assert this is part of the multichain
                for (let mb of mountBlocks) {
                  if (foundRootBlockToMountBranch) {
                    break;
                  }
                  //wtc.write(`11,${Number(Date.now())}\n`)
                  const bl = await this._engine.persistence.getBlockByHash(mb, BC_SUPER_COLLIDER, {
                    asHeader: false,
                    cached: true
                  });
                  if (bl) {
                    isValidSeq = await this._multiverse.validateBlockSequenceInline([newBlock, prevBlock], bl);
                    if (isValidSeq.valid) {
                      foundRootBlockToMountBranch = true;
                      debug(`mount block located ${bl.getHash().slice(0, 21)}`);
                    } else {
                      //foundRootBlockToMountBranch = true
                      debug(`mount block located ${bl.getHash().slice(0, 21)} with invalid sequence`);
                    }
                  }
                }

                if (!foundRootBlockToMountBranch) {
                  this._logger.warn(`unable to find root mount block for sequence ${newBlock.getHeight()} : ${newBlock.getHash().slice(0, 21)}`);
                  isValidSeq = await this._multiverse.validateBlockSequenceInline([newBlock, prevBlock], false);

                  await this._engine.persistence.saveBlock(prevBlock);
                  await this._engine.persistence.putBlock(prevBlock, 0, BC_SUPER_COLLIDER, {
                    asHeader: false,
                    fromWaypoint: true,
                    saveHeaders: true
                  });
                } else {

                  await this._engine.persistence.saveBlock(prevBlock);
                  await this._engine.persistence.putBlock(prevBlock, 0, BC_SUPER_COLLIDER, {
                    asHeader: false,
                    fromWaypoint: true,
                    saveHeaders: true
                  });
                  ///// found root block mount set prev block
                }
              }
            }
          } else {
            // LDL
            debug(`mount block not required comparing ${newBlock.getHeight()} : ${newBlock.getHash().slice(0, 4)} - prev: ${newBlock.getPreviousHash().slice(0, 4)}, with prev block ${prevBlock.getHeight()} : ${prevBlock.getHash().slice(0, 4)}`);
            isValidSeq = await this._multiverse.validateBlockSequenceInline([newBlock, prevBlock], false);
            debug(`${newBlock.getHeight()} : ${newBlock.getHash().slice(0, 4)} required isolated review`);
          }

          if (prevBlock && new BN(newBlock.getTotalDistance()).lt(new BN(prevBlock.getTotalDistance()))) {
            if (blockQueue[0] && parseInt(blockQueue[0].getHeight(), 10) !== parseInt(newBlock.getHeight(), 10)) {
              //wtc.write(`16,${Number(Date.now())}\n`)
              const nb = await this._engine.persistence.getBlocksByHeight(parseInt(newBlock.getHeight(), 10), BC_SUPER_COLLIDER, {
                asHeader: false,
                cached: false
              });
              if (nb) {
                for (let b of nb) {
                  if (b.getHash() !== newBlock.getHash() && reviewBlockHashes.indexOf(b.getHash()) < 0) {
                    reviewBlockHashes.push(b.getHash());
                    blockQueue.unshift(b);
                  }
                }
              }
            }
            this._logger.warn(`child heights are not valid for given ${newBlock.getHeight()} ${newBlock.getHash()}`);
            if (validBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
              // already valid block at height
              if (invalidBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
                blockQueue.unshift(newBlock);
              }
              invalidBlockHeights.push(parseInt(newBlock.getHeight(), 10));
            }
            validDataUpdate = false;
            //wtc.write(`17,${Number(Date.now())}\n`)
            continue;
          }

          if (!isValidSeq.valid && blockQueue[0] && parseInt(blockQueue[0].getHeight(), 10) !== parseInt(newBlock.getHeight(), 10)) {
            if (blockQueue[0] && parseInt(blockQueue[0].getHeight(), 10) !== parseInt(newBlock.getHeight(), 10)) {
              //wtc.write(`18,${Number(Date.now())}\n`)
              const nb = await this._engine.persistence.getBlocksByHeight(parseInt(newBlock.getHeight(), 10), BC_SUPER_COLLIDER, {
                asHeader: false,
                cached: false
              });
              if (nb) {
                for (let b of nb) {
                  if (b.getHash() !== newBlock.getHash() && reviewBlockHashes.indexOf(b.getHash()) < 0) {
                    const d = this._knownHashes.indexOf(b.getHash());
                    if (d > -1) {
                      this._knownHashes.splice(d, 1);
                    }
                    reviewBlockHashes.push(b.getHash());
                    blockQueue.unshift(b);
                  }
                }
              }
            }
          }

          if (!isValidSeq.valid && blockQueue[0] && blockQueue[0].getHeight() !== newBlock.getHeight()) {
            this._logger.info(`no other sequences available, setting block height to search for edge ${newBlock.getHeight()}, should reenable`);
            // USE ONLY WHEN INTER OVERLINE NODE IS ENABLED
            // check if there are other options at this height
            const optionsAt = await this._engine.persistence.getBlocksByHeight(parseInt(newBlock.getHeight(), 10), BC_SUPER_COLLIDER, { asHashes: true });
            if (!optionsAt || optionsAt && optionsAt.length < 1) {

              this._logger.info(`no alternative paths for height ${newBlock.getHeight()} <- storing block`);
            } else if (optionsAt.indexOf(newBlock.getHash()) > -1) {
              this._logger.info(`alternative path already includes block: ${newBlock.getHeight()} yielding...`);

              for (const b of optionsAt) {
                if (b !== newBlock.getHash()) {
                  const fb = await this._engine.persistence.getBlockByHash(b, BC_SUPER_COLLIDER, { cached: true });
                  if (fb) {
                    this._logger.info(`following edge: ${fb.getHeight()}...`);
                    blockQueue.unshift(fb);
                  }
                }
              }
            }

            // MMM
            continue;
          } else if (!isValidSeq.valid && parseInt(newBlock.getHeight(), 10) === parseInt(prevBlock.getHeight(), 10)) {
            this._logger.info(`branch at ${newBlock.getHeight()} : ${newBlock.getHash().slice(0, 8)} ${newBlock.getPreviousHash()}`);

            if (blockQueue.length === 0) {
              // shift window back
              currentHeight = parseInt(newBlock.getHeight(), 10) - (Math.floor(Math.random() * 3) + 2);
              this._logger.info(`shifting request segment back ${currentHeight} : ${newBlock.getHash().slice(0, 8)}`);
            }

            continue;
          } else if (parseInt(newBlock.getHeight(), 10) === parseInt(prevBlock.getHeight(), 10) + 1) {

            const isolatedValidation = isValidBlock(newBlock);
            debug(`isolated validation ${newBlock.getHeight()} : ${newBlock.getHash().slice(0, 8)} ${newBlock.getPreviousHash()} <- ${isolatedValidation} connected: ${newBlock.getBlockchainHeadersCount()}`);

            if (!isolatedValidation) {
              this._logger.info(`considered unvalid  ${newBlock.getHeight()} : ${newBlock.getHash().slice(0, 8)} ${newBlock.getPreviousHash()}`);
              if (invalidBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
                if (validBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
                  invalidBlockHeights.push(parseInt(newBlock.getHeight(), 10));
                }
              }
              // LDL
              if (blockQueue[0] && parseInt(blockQueue[0].getHeight(), 10) !== parseInt(newBlock.getHeight(), 10)) {
                const nb = await this._engine.persistence.getBlocksByHeight(parseInt(newBlock.getHeight(), 10), BC_SUPER_COLLIDER, {
                  asHeader: false,
                  cached: true
                });
                if (nb) {
                  for (let b of nb) {
                    if (b.getHash() !== newBlock.getHash() && reviewBlockHashes.indexOf(b.getHash()) < 0) {
                      const d = this._knownHashes.indexOf(b.getHash());
                      if (d > -1) {
                        this._knownHashes.splice(d, 1);
                      }
                      reviewBlockHashes.push(b.getHash());
                      blockQueue.unshift(b);
                    }
                  }
                }
              }
              this._logger.info(`yielding block ${newBlock.getHeight()} after isolated block assertion`);
              validDataUpdate = false;

              continue;
            } else {
              // MMM
            }
          }
          const purposedBlockChildHeightSum = childrenHeightSum(newBlock);
          const latestBlockChildHeightSum = childrenHeightSum(prevBlock);
          if (new BN(purposedBlockChildHeightSum).lt(new BN(latestBlockChildHeightSum))) {
            this._logger.warn(`child height sumation failed block ${prevBlock.getHeight()} : ${prevBlock.getHash().slice(0, 8)} -> ${newBlock.getHeight()} : ${newBlock.getPreviousHash().slice(0, 8)} missing ${latestBlockChildHeightSum - purposedBlockChildHeightSum}, prev: ${latestBlockChildHeightSum}, new: ${purposedBlockChildHeightSum}`);
            if (blockQueue[0] && parseInt(blockQueue[0].getHeight(), 10) !== parseInt(newBlock.getHeight(), 10)) {
              const nb = await this._engine.persistence.getBlocksByHeight(parseInt(newBlock.getHeight(), 10), BC_SUPER_COLLIDER, {
                asHeader: false,
                cached: false
              });
              if (nb) {
                for (let b of nb) {
                  if (b.getHash() !== newBlock.getHash() && reviewBlockHashes.indexOf(b.getHash()) < 0) {
                    const d = this._knownHashes.indexOf(b.getHash());
                    if (d > -1) {
                      this._knownHashes.splice(d, 1);
                    }
                    reviewBlockHashes.push(b.getHash());
                    blockQueue.unshift(b);
                  }
                }
              }
            }
            if (invalidBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
              if (validBlockHeights.indexOf(parseInt(newBlock.getHeight(), 10)) < 0) {
                invalidBlockHeights.push(parseInt(newBlock.getHeight(), 10));
              }
            }
            continue;
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
            const rawSyncProgress = parseFloat(syncProgress).toFixed(4);
            syncProgress = parseFloat(syncProgress).toFixed(2);
            if (rawSyncProgress > 99.9999 && syncedBeforeData !== 'pending' && BC_USER_QUORUM === DEFAULT_QUORUM) {
              syncThrottleMS = 150;
              syncLookBack = 1;
              const cbs = newBlock.getBlockchainHeadersCount ? newBlock.getBlockchainHeadersCount() : 0;
              this._childBlocksSynced = this._childBlocksSynced + cbs;
            } else {
              const childBlocks = newBlock.getBlockchainHeadersCount ? newBlock.getBlockchainHeadersCount() : 0;
              this._childBlocksSynced = this._childBlocksSynced + childBlocks;
              const embPerf = this._engine._emblemPerformance && this._engine._emblemPerformance > 0 ? Math.floor(this._engine._emblemPerformance * 10) : 0;
              const radPower = this._engine._emblemPerformance && this._engine._emblemPerformance > 0 ? Math.floor(this._engine._emblemPerformance * 6757) : 0;
              if (rawSyncProgress > 99.99) {
                this._logger.info(`OL #${newBlock.getHeight()}:${highestKnownHeight} ${this._childBlocksSynced}:${childBlocks} ${newBlock.getHash().slice(0, 8)}:${newBlock.getPreviousHash().slice(0, 8)} <- EMB MINING POWER: +${embPerf}% OL (${radPower} RAD/s)`);
              } else if (newBlock.getHeight() % 2 === 0) {
                this._logger.info(`OL #${newBlock.getHeight()}:${highestKnownHeight} ${this._childBlocksSynced}:${childBlocks} ${syncProgress}% <- ${newBlock.getHash().slice(0, 8)}:${newBlock.getPreviousHash().slice(0, 8)} <- EMB MINING POWER: +${embPerf}% OL (${radPower} RAD/s)`);
              } else {
                this._logger.info(`OL #${newBlock.getHeight()}:${highestKnownHeight} ${this._childBlocksSynced}:${childBlocks} ${syncProgress}% <- ${newBlock.getPreviousHash().slice(0, 8)}:${newBlock.getHash().slice(0, 8)} <- EMB MINING POWER: +${embPerf}% OL (${radPower} RAD/s)`);
              }
              this._engine.pubsub.publish('sync.status', {
                blockHeight: newBlock.getHeight(),
                blockHash: newBlock.getHash(),
                childBlocks: childBlocks,
                percentSynced: rawSyncProgress
              });
            }
          }

          finalValidBlocks.push(newBlock);
          validBlockHeights.push(parseInt(newBlock.getHeight(), 10));
          validBlockHeights.push(parseInt(newBlock.getHeight(), 10) - 1);
          if (highestKnownHeight < currentHeight) {
            highestKnownHeight = currentHeight;
          }
          validBlocks++;
          this._knownHashes.push(blockHash);
          lastBlock = newBlock;
        } else {
          if (!new BN(newBlock.getHeight()).eq(new BN(2)) && !prevBlock) {
            this._logger.warn(`new block ${newBlock.getHeight()} height and prev block does not exist and sync complete is now false`);
            this._syncComplete = false;
          }
          // otherwise store the block
          this._logger.warn(`prevBlock false and or new block height ${newBlock.getHeight()}`);
        }
      } else if (parseInt(newBlock.getHeight(), 10) < 4) {
        if (!highestBlockInQueue) {
          highestBlockInQueue = newBlock;
        } else if (new BN(highestBlockInQueue.getHeight()).lt(new BN(newBlock.getHeight()))) {
          highestBlockInQueue = newBlock;
        }
        validBlocks++;
        finalValidBlocks.push(newBlock);
      } else if (!validDataUpdate) {
        this._logger.warn(`malformed block ${newBlock.getHeight()} cannot be processed`);
      } else {
        this._logger.info(`unable to validate block in invalid sequence ${newBlock.getHeight()}`);
      }
      //}
    } while (blockQueue.length > 0 && !forceBreak && !blocksProvidedOutsideBoundary && !brokenSegment && !segmentKnown);
    if (!checkCoinbaseBlock) {
      this._logger.warn('unable to process segment');
      this.addToQuarantine(address, 'invalid coinbase check block from given segment');
      await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      return;
    }
    // before cb eval give the current waypoint an expiration boost
    if (currentPeer) {
      currentPeer.setAddress(addressToHost(address));
      currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
    }
    if (invalidBlockHeights.length > 0) {
      this._logger.info(`setting edge without coinbase ${invalidBlockHeights.length}`);
    }
    let validcb = invalidBlockHeights.length === 0 ? await validateCoinbase(checkCoinbaseBlock, this._engine.persistence, this._engine, this._engine._txHandler, this._engine._txPendingPool, this._engine._utxoManager, 'p2p.node') : true;
    if (!validcb) {
      await this._engine.persistence.saveBlock(checkCoinbaseBlock);
      await this._engine.persistence.putBlock(checkCoinbaseBlock, 0, BC_SUPER_COLLIDER, {
        asHeader: false,
        fromWaypoint: true,
        saveHeaders: true
      });
      await this._engine.persistence.saveBlock(checkCoinbaseBlock);
      this._knownHashes.length = 0;
      this._temporaryBlockStore = {};
      this._logger.info(`coinbase check: ${checkCoinbaseBlock.getHeight()}:${checkCoinbaseBlock.getHash()}`);
      // a missing block has invalid txs
      const remount = await this._engine.persistence.getUtxoRemount();
      if (remount) {
        await this._engine.persistence.delUtxoRemount();
        if (remount >= lowestBoundaryBlocks) {
          if (invalidBlockHeights.indexOf(remount) < 0) {
            invalidBlockHeights.push(remount);
          }
          this._logger.warn(`${remount} block found in critical relative root position ${addressToHost(address)}`);
          this._PEER_BLACKLIST.push(addressToHost(address));
          await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
          await this._engine.persistence.reorgBlockchain();
          await this._engine.reorgTxPendingPool();
          return;
        } else {
          const consensusKey = `${checkCoinbaseBlock.getHeight()}:${checkCoinbaseBlock.getHash()}`;

          this._logger.warn(`${remount} block found in critical root position, running large reindex commmand...`);
          this.addToQuarantine(addressToHost(address), `critical reindex required`, true);
          if (this._PEER_CONSENSUS[consensusKey]) {
            this._PEER_CONSENSUS[consensusKey]++;
          } else {
            this._PEER_CONSENSUS[consensusKey] = 1;
          }

          if (this._PEER_CONSENSUS[consensusKey] < BC_PEER_CONSENSUS_THRESHOLD) {
            const stepBackHeight = remount - getRandomWithinRange(1080, 2080);
            const bh = await this._engine.persistence.getBlockByHeight(stepBackHeight);
            if (bh) {
              this._logger.info(`moving search range back to ${stepBackHeight}`);
              const tns = Math.floor(Date.now() / 1000);
              await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${parseInt(bh.getHeight(), 10)}:${tns}`);
              await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.block.reorgfrom`, bh);
              await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'complete');
              await this._engine.persistence.putLatestBlock(bh, BC_SUPER_COLLIDER, { iterateUp: false, chainState: this._chainState });
              await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
              await this._engine.persistence.reorgBlockchain({ fromBlock: bh });
              await this._engine.reorgTxPendingPool();
              // this._engine._emitter.emit('requestBlockRange', [stepBackHeight + BC_MAX_DATA_RANGE, stepBackHeight - 1], 2)
              return;
            }

            await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
            await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
            await this._engine.persistence.reorgBlockchain();
            await this._engine.reorgTxPendingPool();
            this._engine._emitter.emit('requestBlockRange', [stepBackHeight + BC_MAX_DATA_RANGE, stepBackHeight - 1], 2);
            return;
          } else {

            let lastKey = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.consensus.index.last`);
            if (!lastKey) {
              lastKey = 0;
            } else {
              lastKey = lastKey + 1;
            }
            this._PEER_QUARANTINE.length = 0;
            this._PEER_EXTENDED_QUARANTINE.length = 0;
            delete this._PEER_CONSENSUS[consensusKey];
            await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.consensus.index.last`, lastKey);
            await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.consensus.index.${lastKey}`, consensusKey);
            await this._engine.persistence.put(consensusKey, lastKey);
            this._logger.info(`miners have determined this block is permitted: ${consensusKey} <- ${lastKey}`);
            validcb = true;
          }
        }
      } else {
        // a missing block is needed
        const unmount = await this._engine.persistence.getUtxoUnmount();
        const consensusKey = `${checkCoinbaseBlock.getHeight()}:${checkCoinbaseBlock.getHash()}`;

        this._logger.warn(`${remount} block found not in position...`);
        //if (this._PEER_CONSENSUS[consensusKey]) {
        //  this._PEER_CONSENSUS[consensusKey]++
        //} else {
        //  this._PEER_CONSENSUS[consensusKey] = 1
        //}

        if (unmount) {

          if (new BN(unmount).gt(new BN(checkCoinbaseBlock.getHeight()))) {
            await this._engine.persistence.delUtxoUnmount();
            this.addToQuarantine(address, 'invalid coinbase check block from given segment');
            this._logger.info(`active sync in progress from mount ${unmount}`);
          } else {

            this._logger.info(`searching for mount: ${unmount} without penalty (${unmount + BC_MAX_DATA_RANGE} -> ${unmount - 4})`);

            //if (invalidBlockHeights.indexOf(unmount) < 0) {
            //  invalidBlockHeights.push(unmount)
            //}

            const unmountRaw = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.unmount`);
            if (unmountRaw) {

              await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.req.blocks`, true);
              const uheight = unmountRaw.split(':')[0];
              const uhash = unmountRaw.split(':')[1];
              const host = addressToHost(address);
              await this._engine.persistence.delUtxoUnmount();

              const block = await getMissingBlock(host, uhash, this._engine.persistence);

              //await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`)
              //this._engine._emitter.emit('requestBlockRange', [unmount + BC_MAX_DATA_RANGE, unmount - 4, conn])
              await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.blocks`);
              await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${uheight - 4}:${Math.floor(Date.now() / 1000)}`, { sync: true });

              if (!block) {
                await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
                await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
                // is didn't have the block to request so request to other waypoints
                this.addToQuarantine(address, 'waypoint unable to resolve edge');
                this._engine._emitter.emit('requestBlockRange', [Number(uheight) + BC_MAX_DATA_RANGE, Number(uheight) - 4], 3);
                return;
              }

              invalidBlockHeights.length = 0;
              // waypoint has resolved missing edge
              this._logger.info(`waypoint resolved edge ${block.getHeight()}:${block.getHash()}`);
            } else {

              this.addToQuarantine(address, `block not provided without unmount`, true);
              await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.blocks`);
              await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
              await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
              await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${unmount - 4}:${Math.floor(Date.now() / 1000)}`, { sync: true });
              this._engine._emitter.emit('requestBlockRange', [unmount + BC_MAX_DATA_RANGE, unmount - 4], 2);
              return;
            }
          }
        } else {
          forceBreak = true;
          //this.addToQuarantine(address, 'unmount not set')
          this._logger.info(`unmount not set on current block: ${checkCoinbaseBlock.getHeight()} searching higher...`);
          let scanBackHeight = checkCoinbaseBlock.getHeight() + 1040;
          const prevFlaggedBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.flagged.${checkCoinbaseBlock.getHeight()}`);
          if (prevFlaggedBlock) {
            this._logger.info(`previous flagged block detected ${prevFlaggedBlock} for OL BLOCK ${checkCoinbaseBlock.getHeight()}`);
            scanBackHeight = prevFlaggedBlock + 1040;
          }
          await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${scanBackHeight}:${Math.floor(Date.now() / 1000)}`, { sync: true });
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.block.flagged.${checkCoinbaseBlock.getHeight()}`, scanBackHeight, { sync: true });
          //await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`)
          this._engine._emitter.emit('requestBlockRange', [scanBackHeight + BC_MAX_DATA_RANGE, scanBackHeight, conn]);
          return;
        }
      }
    }

    debug(`loaded: ${validBlocks}, from memory: ${blocksLoadedFromMemory}, height: ${currentHeight}`);

    if (this._PEER_RECORD[addressToHost(address)] && !scheduledForNextTick) {
      if (this._PEER_RECORD[addressToHost(address)]) {
        if (finalValidBlocks.length > 0) {
          const lbk = finalValidBlocks[finalValidBlocks.length - 1];
          const lbkh = lbk.getHash();
          const lastSeenHash = this._PEER_RECORD[addressToHost(address)].lastSeenHash;
          if (lbkh === lastSeenHash) {

            await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
            debug(`edge is known <- ${lbkh} (${this._PEER_RECORD[addressToHost(address)].lastSeen})`);
            this._PEER_RECORD[addressToHost(address)].lastSeen = Date.now();

            if (finalValidBlocks.length < 3 && blocksLoadedFromMemory > validBlocks) {
              debug(`waypoint age reset (${this._PEER_RECORD[addressToHost(address)].lastSeen})`);
              this._syncComplete = true;
            } else {
              const sMax = BC_MAX_DATA_RANGE;
              const sBack = Math.floor(Math.random() * sMax) + 3;
              const sFrom = max(3, currentHeight - sBack);
              debug(`waypoint demoted: ${this._PEER_RECORD[addressToHost(address)].lastSeen}, current height: ${currentHeight}`);
              await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
              this._engine._emitter.emit('requestBlockRange', [currentHeight + 6, sFrom]);
              return;
            }
          } else {
            this._PEER_RECORD[addressToHost(address)].lastSeenHash = lbkh;
            this._PEER_RECORD[addressToHost(address)].lastSeen = Date.now();
          }
        }
      }
    }

    if (scheduledForNextTick) {
      // LDL
      debug(`segment has been scheduled for evaluation on next cycle`);
      return;
    }

    if (flag) {
      this._utxoCycles = 0;
    }

    invalidBlockHeights = invalidBlockHeights.sort((a, b) => {
      if (!isNaN(a) && !isNaN(b)) {
        if (a > b) {
          return 1;
        } else if (a < b) {
          return -1;
        }
        return 0;
      } else {
        return 0;
      }
    });

    for (let v of invalidBlockHeights) {
      if (validBlockHeights.indexOf(v) < 0) {
        finalInvalidBlocks.push(v);
      }
    }

    if (finalInvalidBlocks.length > 0) {
      // LDL
      debug(`---- ${finalInvalidBlocks.length} INVALID BLOCKS ----`);
      debug(finalInvalidBlocks);
    } else {
      debug(`---- 0 INVALID BLOCKS ----`);
    }

    if (blocksProvidedOutsideBoundary && invalidBlockHeights.length < 1) {
      this._logger.info(`DATA received outside provided boundary: ${latestHeightRawBoundary}`);
      //await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`)
      //this.addToQuarantine(address, 'sent blocks outside of requested boundary')
      //return
    }

    if (highestBlockInQueue && highestBlock && new BN(highestBlockInQueue.getHeight()).gt(new BN(highestBlock.getHeight()))) {
      highestBlock = highestBlockInQueue;
    }

    if (highestBlockInQueue && !highestBlock) {
      highestBlock = highestBlockInQueue;
    }

    const tn = Date.now();
    const latestBlockHeightFinal = parseInt(latestBlock.getHeight(), 10);
    evalBlock = latestBlock;
    if (highestBlock) {
      evalBlock = highestBlock;
    }

    if (sequenceFailed) {
      debug(`sequence invalid block heights and final invalid blocks`);
      invalidBlockHeights.length = 0;
      finalInvalidBlocks.length = 0;
    }

    if (blocksLength < BC_MAX_DATA_RANGE && validBlocks > 0 && parseInt(evalBlock.getHeight(), 10) + BC_MAX_DATA_RANGE < highestKnownHeight && finalValidBlocks.length > 9 && finalValidBlocks.length !== 1 && parseInt(evalBlock.getHeight(), 10) < highestKnownHeight) {
      this._logger.info(`stale blocks from waypoint height ${evalBlock.getHeight()}, valid: ${validBlocks}`);

      if (lowestBoundary && invalidBlockHeights[0] < lowestBoundary && blocksLoadedFromMemory < 2) {
        this._logger.info(`lower segment detected ${lowestBoundary} -> searching waypoint...`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
        this._engine._emitter.emit('requestBlockRange', [invalidBlockHeights[0] + BC_MAX_DATA_RANGE, invalidBlockHeights[0] - 3, conn]);
        return;
      } else if (lowestBoundary && invalidBlockHeights[0] < lowestBoundary) {

        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        this.addToQuarantine(address, 'lowest segment block has invalid heights');

        this._logger.info(`lower segment detected ${lowestBoundary} -> searching waypoints...`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
        this._engine._emitter.emit('requestBlockRange', [invalidBlockHeights[0] + BC_MAX_DATA_RANGE, invalidBlockHeights[0] - 3]);
        return;
      }

      if (BC_ORTHOGONAL_WAYPOINTS) {
        const sMax = 2 * BC_MAX_DATA_RANGE;
        const sBack = Math.floor(Math.random() * sMax) + 3;
        const sFrom = max(3, currentHeight - sBack);
        await this.findBlockRange(sFrom, sFrom + BC_MAX_DATA_RANGE);
      } else if (logline) {
        const sMax = 2 * BC_MAX_DATA_RANGE;
        const sBack = Math.floor(Math.random() * sMax) + 3;
        const sFrom = max(3, currentHeight - sBack);
      } else {
        const finalValidBlock = finalValidBlocks[0];
        const sMax = BC_MAX_DATA_RANGE - 5;
        const sBack = Math.floor(Math.random() * sMax) + 3;
        const sFrom = max(2, currentHeight - sBack);
        this.addToQuarantine(address, 'waypoint has not provided highest edge', 1);
        this._logger.info(`waypoint has not provided highest edge ${highestKnownHeight} yielding multiverse for ${finalValidBlock.getHeight()}...`);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${parseInt(finalValidBlock.getHeight(), 10) - 1}:${tn}`);
        //await this._engine.persistence.putLatestBlock(finalValidBlock, BC_SUPER_COLLIDER, {iterateUp: false})
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);

        if (finalValidBlock) {
          this._logger.info(`setting latest block ${finalValidBlock.getHeight()} : ${finalValidBlock.getHash()}`);
          await this._engine.persistence.putLatestBlock(finalValidBlock, BC_SUPER_COLLIDER, { iterateUp: true, chainState: this._chainState });
        }

        this._engine._emitter.emit('requestBlockRange', [sFrom + BC_MAX_DATA_RANGE, sFrom - 2], 3);
        return;
      }
      //} else if (!mountBlockFound || segmentUnlinked) {
    } else if (segmentUnlinked) {
      // the sequence provided was unable to be merged onto the local multichain
      const synced = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
      const lb = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
      this._logger.warn(`waypoint unable to provide segment linked: ${!segmentUnlinked}, mounted: ${mountBlockFound}, sequence confirmed: ${!sequenceFailed} <- all blocks stored pending evaluation...synced status: ${synced}`);
      const reorgBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
      const validBlock = lb && finalValidBlocks && finalValidBlocks.length ? finalValidBlocks[0] : false;
      const fromStepBack = validBlock ? max(2, parseInt(validBlock.getHeight(), 10) - 212) : 0;
      const shouldStepBack = validBlock && parseInt(validBlock.getHeight()) > parseInt(latestBlock.getHeight(), 10) && BigInt(latestBlock.getTotalDistance()) < BigInt(validBlock.getTotalDistance());
      if (fromStepBack > 0 && fromStepBack < 10) {
        this.addToQuarantine(address, 'waypoint sent disconnected segments');
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        await this._engine.persistence.reorgBlockchain();
        await this._engine.reorgTxPendingPool();
        return;
      }
      if (this._PEER_QUARANTINE.length <= 11 && synced === 'pending' && validBlock) {
        this._logger.info(`waypoint unable to provide mount ${fromStepBack}`);
        this.addToQuarantine(address, 'waypoint unable to provide mount for requested segments');
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${fromStepBack}:${tn}`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      } else if (this._PEER_QUARANTINE.length <= 11 && synced === 'complete' && shouldStepBack) {
        // push null counter
        debug(`PQ WARNING: 3 for ${addressToHost(address)} added placeholder`);
        this.addToQuarantine('0.0.0.0', 'waypoint queue increased in size, unhealthy network');
        this._logger.info(`searching waypoints directly for segment from collision ${fromStepBack} for window of ${(12 - this._PEER_QUARANTINE.length) * 612}`);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${fromStepBack}:${tn}`);

        return;
        // this is a potentially better chain and the local node has not found a final edge
        // remove the peer record and begin searching back
      } else if (synced === 'pending' && finalValidBlocks.length > 4 && this._PEER_QUARANTINE.length <= 16 && shouldStepBack) {

        debug(`PQ WARNING: 3 for ${addressToHost(address)} added placeholder`);
        this.addToQuarantine('0.0.0.0', 'waypoint queue increased in size, unhealthy network while stepping back');
        this._logger.info(`searching waypoint directly for segment from collision ${fromStepBack} for window of ${(12 - this._PEER_QUARANTINE.length) * 612}`);

        const data = [fromStepBack, fromStepBack + BC_MAX_DATA_RANGE];
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.req.range`, `${fromStepBack + BC_MAX_DATA_RANGE}:${fromStepBack}:${Math.floor(now / 1000)}:na`);
        const payload = encodeTypeAndData(MESSAGES.GET_DATA, data);
        const sent = await this.qsend(conn, payload);
        if (sent !== undefined && sent.success) {
          debug(`GET_DATA sent to ${sent.address}, message: ${sent.message}`);
        } else {
          debug(`GET_DATA request yielded from ${address}`);
          debug(`PQ WARNING: 4 for ${addressToHost(address)}`);
          this.addToQuarantine(address, 'unable to send get DATA request to waypoint');
        }
        return;
        // this is a potentially better chain and the local node has found a final edge
      } else if (synced === 'pending') {
        this._logger.info(`waypoint is not considered stable for segment from collision ${fromStepBack}, synced: ${synced}`);
        this.addToQuarantine(address, 'waypoint is unstable unable to provide blocks back');
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        await this._engine.persistence.reorgBlockchain();
        await this._engine.reorgTxPendingPool();
      } else if (synced === 'complete' && reorgBlock) {
        this._logger.info(`waypoint is not considered stable for segment from collision ${fromStepBack}, synced: ${synced}`);
        debug(`PQ WARNING: 6 for ${addressToHost(address)}`);
        this.addToQuarantine(address, 'waypoint is unstable, collision found between requested segments');
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${parseInt(reorgBlock.getHeight(), 10) - 1}:${tn}`);
        await this._engine.persistence.reorgBlockchain();
        await this._engine.reorgTxPendingPool();
      } else if (synced === 'complete') {
        this._logger.info(`waypoint is not considered stable for segment from collision ${fromStepBack}, synced: ${synced}`);
        debug(`PQ WARNING: 9 for ${addressToHost(address)}`);
        this.addToQuarantine(address, 'waypoint unable to provided connected segments and local node is synced');
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      }
      return;
    } else if (finalInvalidBlocks.length > 0 && blocksLength > 1) {
      // randomly request a seperate waypoint for the missing block range
      if (lowestBoundary && invalidBlockHeights[0] < lowestBoundary - 201) {
        this._logger.info(`lower segment detected ${lowestBoundary} searching from new waypoint...`);
        this._logger.info(`requesting ${invalidBlockHeights[0] + BC_MAX_DATA_RANGE} to ${invalidBlockHeights[0] - 3}`);
        this.addToQuarantine(address, 'lower segment detected, searching for range from other waypoints');
        this._engine._emitter.emit('requestBlockRange', [invalidBlockHeights[0] + BC_MAX_DATA_RANGE, invalidBlockHeights[0] - 3]);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        return;
      }

      finalInvalidBlocks.sort();
      // reset known segments
      this._knownBlockSegments.clear();
      // delete the offending peer
      // sets up a special range request case in multiverse
      this._logger.info(`stale blocks <- ${invalidBlockHeights}`);
      if (invalidBlockHeights.length === 1) {
        const invalidHeight = invalidBlockHeights[0];
        if (!INVALID_BLOCK_TABLE[invalidHeight]) {
          INVALID_BLOCK_TABLE[invalidHeight] = 0;
        }
        INVALID_BLOCK_TABLE[invalidHeight]++;
      }
      // permit up to 3 quarantined peers before moving to searching for a better chain
      if (this._PEER_QUARANTINE.length >= 16 && this._PEER_BLACKLIST.length > 4) {
        for (let p of this._PEER_QUARANTINE) {
          if (this._PEER_BLACKLIST.indexOf(p) < 0) {
            debug(`PQ WARNING: 7 for ${p}`);
            this._PEER_BLACKLIST.push(p);
          }
        }

        // break the invalid chain
        await this._engine.persistence.reorgBlockchain({
          fromBlock: getGenesisBlock(),
          iterateUp: false
        });
        await this._engine.reorgTxPendingPool();
        return;
      } else if (this._PEER_QUARANTINE.length < 16) {
        debug(`PQ WARNING: 8 for ${addressToHost(address)}`);
        const finalValidBlock = finalValidBlocks.length > 0 ? finalValidBlocks[finalValidBlocks.length - 1] : false;
        let dls = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);
        let dlh = false;
        let dt = false;
        let numberOfWaypoints = false;
        this._knownHashes.length = 0;
        if (dls) {
          dlh = parseInt(dls.split(':')[0], 10);
          dt = parseInt(dls.split(':')[1], 10);
        }
        if (BC_ORTHOGONAL_WAYPOINTS) {
          let wst = 2 * BC_MAX_DATA_RANGE;
          let stBack = Math.floor(Math.random() * wst) + 3;
          let stFrom = max(3, currentHeight - stBack);
          this.addToQuarantine(address, 'waypoint unable to provide minimal requested range');
          await this.findBlockRange(stFrom, stFrom + BC_MAX_DATA_RANGE);
        } else if (!finalValidBlock || dls && new BN(dlh).lt(new BN(finalValidBlock.getHeight()))) {
          // move the edge to a position between 1 and 9 below the last known height
          let moveBackRange = forceBreak ? 280 : 28;
          let movingEdge = dlh - Math.floor(Math.random() * Math.floor(moveBackRange + 28));
          let numberOfWaypoints = false;
          if (finalInvalidBlocks.length > 0) {
            movingEdge = finalInvalidBlocks[0] - Math.floor(Math.random() * Math.floor(moveBackRange + 10));
          }
          if (invalidBlockHeights.length > 1 && !searchWaypointLower) {
            numberOfWaypoints = 3;
            this.addToQuarantine(address, 'more than 1 invalid block height provided in range');
            await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
          }
          let co = !numberOfWaypoints ? conn : null;
          this._logger.info(`setting search edge to ${movingEdge}, move back range: ${moveBackRange}`);
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${movingEdge}:${tn}`);
          this._engine._emitter.emit('requestBlockRange', [movingEdge + BC_MAX_DATA_RANGE - 2, movingEdge - 2, co], numberOfWaypoints);
          return;
        } else {
          if (invalidBlockHeights.length > 0 && !searchWaypointLower) {
            numberOfWaypoints = 3;
            await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
            if (this._PEER_QUARANTINE.indexOf(addressToHost(address)) < 0) {
              this.addToQuarantine(address, 'number of waypoints unavailable for lower segments');
            }
          }
          this._logger.info(`setting search edge and data.latest to last confirmed ${finalValidBlock.getHeight()}`);
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${parseInt(finalValidBlock.getHeight(), 10) - 8}:${tn}`);
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.block.reorgfrom`, finalValidBlock);
          await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
          await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.range`);
          await this._engine.persistence.putLatestBlock(finalValidBlock, BC_SUPER_COLLIDER, { iterateUp: false, chainState: this._chainState });
          this._engine._emitter.emit('requestBlockRange', [parseInt(finalValidBlock.getHeight(), 10) - 10, parseInt(finalValidBlock.getHeight(), 10) - 50], numberOfWaypoints);
        }
        return;
      } else {
        return;
      }
    }

    if (unseenBlocks === 0 && blocksLength >= BC_MAX_DATA_RANGE) {
      debug(`blocks are above MAX_DATA_RANGE ${blocksLength}`);
    }

    if (segmentKey) {
      this._knownBlockSegments.set(segmentKey, true);
    }

    const latestEdge = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
    const currentHigherLatestEdge = currentHeight >= parseInt(latestEdge, 10);

    if (validBlocks >= minimumValidBlocks && new BN(currentHeight).gte(new BN(latestBlock.getHeight() - 1)) && !invalidData) {

      if (checkCoinbaseBlock && !highestBlock) {
        highestBlock = checkCoinbaseBlock;
      }

      if (!highestBlock && new BN(currentHeight).gt(latestBlock.getHeight())) {
        highestBlock = await this._engine.persistence.getBlockByHeight(currentHeight, BC_SUPER_COLLIDER, { asBuffer: true });
        if (!highestBlock) {
          highestBlock = latestBlock;
        }
      } else {
        highestBlock = latestBlock;
      }

      if (checkCoinbaseBlock && validcb && highestBlock.getHeight() < checkCoinbaseBlock.getHeight() && !forceBreak) {
        debug(`would have block ${highestBlock.getHeight()} replaced...`);
        //highestBlock = checkCoinbaseBlock
        //currentHeight = parseInt(checkCoinbaseBlock.getHeight(), 10)
      }

      debug(`stored block ${highestBlock.getHeight()} as last known latest block current height: ${currentHeight - 100}`);
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${currentHeight - 16}:${now}`);
      debug(`setting highest block as ${highestBlock.getHeight()}`);
      if (validDataUpdate && currentHeight >= highestKnownHeight && highestKnownHeight !== 1) {
        debug(`current height is greater than or equal to highest known height ${highestKnownHeight}`);
        this._syncComplete = true;
      }
    }

    if (latestEdge && blocksLength < BC_MAX_DATA_RANGE + 6 && validBlocks > 0 && currentHigherLatestEdge && validBlocks >= minimumValidBlocks && finalInvalidBlocks.length < 1) {
      debug(`sync complete is potentially ready due to minimum valid blocks and current highest edge ${parseInt(latestEdge, 10)}`);
      if (highestBlockInQueue && parseInt(highestBlockInQueue.getHeight(), 10) > parseInt(highestBlock.getHeight(), 10)) {
        highestBlock = highestBlockInQueue;
      }
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

    const chb = currentHeight + 1;
    const chc = currentHeight;
    const chbv = new BN(finalLatestBlock.getHeight()).eq(new BN(chb)) && dlh + 200 > highestKnownHeight;
    const chcv = new BN(finalLatestBlock.getHeight()).eq(new BN(chc)) && dlh + 200 > highestKnownHeight;
    const chdv = !highestBlock ? false : highestBlock.getHash() === latestBlock.getPreviousHash();
    const chev = !highestBlock ? false : highestBlock.getHash() === finalLatestBlock.getPreviousHash();

    if (chbv) {
      this._logger.info(`the sync is considered complete latestBlock: ${finalLatestBlock.getHeight()} highestCurrent: ${currentHeight} - 1 blocks sent: ${blocks.length}`);
      this._syncComplete = true;
    }

    if (chcv) {
      this._logger.info(`the sync is considered complete latestBlock: ${finalLatestBlock.getHeight()} highestCurrent: ${currentHeight} blocks sent: ${blocks.length}`);
      this._syncComplete = true;
    }

    if (chdv) {
      this._logger.info(`the sync is considered complete latestBlock: ${finalLatestBlock.getHeight()} previous hash equals current highest block hash: ${evalBlock.getHash()}`);
      this._syncComplete = true;
    }

    if (chev) {
      this._logger.info(`evalblock completes the hash sequence for latestBlock: ${finalLatestBlock.getHeight()} eval block: ${evalBlock.getHeight()}`);
      this._syncComplete = true;
    }

    if (evalBlock && new BN(evalBlock.getHeight()).lt(new BN(currentHeight)) && parseInt(evalBlock.getHeight(), 10) - currentHeight < BC_MAX_DATA_RANGE && parseInt(evalBlock.getHeight(), 10) > 1) {
      this._logger.info(`eval block ${evalBlock.getHeight()} is less than current height`);
    }

    // if boundaries have
    if (checkBoundaries && validBlocks >= minimumValidBlocks) {
      debug(`boundaries have been set lower: ${this._blockRangeLowerBound.height} upper: ${this._blockRangeUpperBound.height}`);
    }

    // LDL
    debug(`processed ${validBlocks} blocks from waypoint filtered to ${finalValidBlocks.length} saved to disk`);
    // if peer sends invalid data it is rejected and removed from the peer data
    if (validBlocks >= minimumValidBlocks && validBlocks > 1 && finalValidBlocks.length < validBlocks && blocksLength < BC_MAX_DATA_RANGE && invalidBlockHeights.length < 1 && parseInt(evalBlock.getHeight(), 10) < highestKnownHeight) {
      this._logger.info(`edge discovered by network that is not available from waypoint, setting initial sync`);
    }

    if (validBlocks < minimumValidBlocks && validBlocks < 1) {
      // reset the best block to the lowest
      this._logger.warn(`setting bc.data.latest = 2, mb: ${minimumValidBlocks}`);
      const now = Date.now();
      debug(`PQ WARNING: 9 for ${addressToHost(address)}`);
      this.addToQuarantine(address, 'waypoint did not send minimum viable blocks');
      this._knownBlockSegments.clear();
      const syncedStatus = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
      await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      if (syncedStatus === 'complete') {
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.block.reorgto`);
      } else {
        await this._engine.persistence.reorgBlockchain({ chainState: this._engine.chainState });
        await this._engine.reorgTxPendingPool();
      }
      await this.processPeerEvaluations();

      // process peer evaluations seeking better candidate
    } else if (this._syncComplete === false && !invalidData && validBlocks > 0) {

      let nextHeight = min(currentHeight + BC_MAX_DATA_RANGE, highestKnownHeight);
      if (blocksLoadedFromMemory > validBlocks && validBlocks > 10 && invalidBlockHeights.length < 1 && !forceBreak) {
        this._logger.info(`slip stream ahead opened: ${nextHeight} -> ${nextHeight + 256}`);
        nextHeight = nextHeight + 256;
        currentHeight = currentHeight + 256;
      }

      const now = Date.now();

      this._logger.info(`setting highest height to ${currentHeight} pending sync...`);
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${currentHeight}:${now}`);
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'pending');
      // get the current best block hash + BC_MAX_DATA_RANGE
      // LDL
      if (nextHeight <= currentHeight) {
        nextHeight = nextHeight + BC_MAX_DATA_RANGE;
      }
      // LDL
      debug(`opened GET_DATA request for ${address} from local: ${currentHeight} next: ${nextHeight}, e: ${highestKnownHeight}`);

      const peerRequestKey = `${address}:${currentHeight}`;
      if (!this._requestRegistry[peerRequestKey]) {
        this._requestRegistry[peerRequestKey] = 1;
      } else {
        this._requestRegistry[peerRequestKey]++;
      }

      if (this._engine._blockStats) {
        for (const finalBlock of finalValidBlocks) {
          debug(`storing ${finalBlock.getHeight()} : ${finalBlock.getHash().slice(0, 12)}`);
          const previousMiner = this._engine._loggedBcBalances.lastMiner;
          this._engine._loggedBcBalances.lastMiner = finalBlock.getMiner();
          if (this._engine._loggedBcBlocks.indexOf(finalBlock.getHash()) < 0) {
            this._engine._loggedBcBlocks.push(finalBlock.getHash());
            if (!this._engine._loggedBcBalances[finalBlock.getMiner()]) {
              this._engine._loggedBcBalances[finalBlock.getMiner()] = Math.round(finalBlock.getNrgGrant());
            } else {
              this._engine._loggedBcBalances[finalBlock.getMiner()] += Math.round(finalBlock.getNrgGrant());
            }
          }
          const newBlocks = finalBlock.getBlockchainHeadersCount ? finalBlock.getBlockchainHeadersCount() : 0;
          this._engine._blockStats.write(`${Math.floor(new Date() / 1000)},${finalBlock.getTimestamp()},${finalBlock.getHeight()},${finalBlock.getHash()},${finalBlock.getDistance()},${finalBlock.getDifficulty()},${finalBlock.getTotalDistance()},${finalBlock.getMiner().slice(2, 30)},${this._engine._loggedBcBalances[finalBlock.getMiner()]},${finalBlock.getTxsList().length},${Math.round(finalBlock.getNrgGrant())},${newBlocks},${Math.floor(new Date() / 1000) - finalBlock.getTimestamp()},${finalBlock.getMiner() === previousMiner ? 1 : 0},2\n`);
        }
      }

      if (!currentPeer.getExpires) {
        currentPeer = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      }

      if (currentPeer) {
        processTime = Math.floor(startProcessTime - now);
        weightedTime = max(0, 1000 + meanTime - processTime);
        currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
      } else {
        // clean up and remove current peer
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      }

      if (waypointStatStream && processTimes.length > 0) {
        waypointStatStream.write(`${processTime},${elapsed},${currentHeight},${nextHeight},${meanTime},${weightedTime},${firstBlockProcessed.height},${lastBlockProcessed.height},${meanBlockProcessTime},${processTimes[0].height},${processTimes[0].processTime},${processTimes[0].newBlocks},${processTimes[0].difficulty},${processTimes[0].txs},${processTimes[0].headers},${addressToHost(address)},${processTimes[0].hash},${processTimes[0].miner}\n`);
        debug(`processed: ${processTime} ms, latency: ${meanTime} ms, weighted latency: ${weightedTime}, seeking: ${currentHeight} - ${nextHeight}, waypoint: ${address}`);
      }

      if (finalValidBlocks.length > 0 && meanTime > 0 && BC_MAX_WAYPOINT_LATENCY < weightedTime && this._PEER_QUARANTINE.length < 6 && !BC_BLOODLINE) {
        // increase the latency in case the node itself has a bad connection
        BC_MAX_WAYPOINT_LATENCY = BC_MAX_WAYPOINT_LATENCY + 2000;
        this._logger.warn(`limited connection to waypoint (${meanTime})...`);
      } else if (meanTime > 0 && BC_MAX_WAYPOINT_LATENCY < weightedTime) {
        this._logger.warn(`poor internet connection to Overline protocol (${meanTime} ms) <- change or disable VPN if one is being used`);
      }

      if (BC_PRUNE_DB) {
        const reorgBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
        if (reorgBlock && parseInt(finalValidBlocks[0].getHeight(), 10) > parseInt(reorgBlock.getHeight(), 10)) {
          const comp = await this._engine.persistence.pruneFromBlock(finalValidBlocks[0], BC_PRUNE_DB_DEPTH, 20);
          if (comp && !isNaN(comp)) {
            this._multiverseCompressions = this._multiverseCompressions + comp;
          }
        }
      }

      if (this._requestRegistry[peerRequestKey] > 600) {
        // meaning we have asked for clarification on the same segment more than 6 times
        debug(`PQ WARNING: 11 for ${addressToHost(address)}`);
        this.addToQuarantine(address, 'waypoint has requested the same segment too often');
        return;
      } else {
        currentHeight = currentHeight - syncLookBack;
        nextHeight = nextHeight + syncLookAhead;
        // LDL
        const data = [currentHeight, max(currentHeight + BC_MAX_DATA_RANGE, nextHeight)];
        debug(`:::::::::::: GET_DATA sending to ${data[0]} -> ${data[1]} `);
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.req.range`, `${nextHeight}:${currentHeight + 1}:${Math.floor(now / 1000)}:${addressToHost(address)}`);
        const payload = encodeTypeAndData(MESSAGES.GET_DATA, data);
        const sent = await this.qsend(conn, payload);
        if (sent !== undefined && sent.success) {
          // LDL
          debug(`GET_DATA sent to ${sent.address}, message: ${sent.message}`);
        } else {
          // LDL
          this._logger.info(`GET_DATA request yielded from ${address}`);
          debug(`PQ WARNING: 12 for ${addressToHost(address)}`);
          this.addToQuarantine(address, 'request yielded from waypoint for invalid edge');
          await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
          this._engine._emitter.emit('requestBlockRange', [data[1] - 10, data[0] - 10], 3);
          return;
        }
      }
      if (evalBlock) {
        // only keep 100 blocks in the temporary block store
        const hre = parseInt(evalBlock.getHeight(), 10);
        for (let h of Object.keys(this._temporaryBlockStore)) {
          let hm = parseInt(this._temporaryBlockStore[h].getHeight(), 10);
          if (hm + 200 < hre || hm - 200 > hre) {
            delete this._temporaryBlockStore[hm];
            delete this._temporaryBlockStore[h];
          }
        }
      }
      debug(`sync is not complete, highest height is ${currentHeight} -> setting ${BC_SUPER_COLLIDER}.data.latest: ${currentHeight} set initialsync: pending`);
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
      }
    } else if (this._syncComplete === true && !invalidData) {
      const now = Date.now();
      debug(`multichain highest edge set <- ${currentHeight}`);
      if (this._engine._blockStats) {
        for (const finalBlock of finalValidBlocks) {
          const previousMiner = this._engine._loggedBcBalances.lastMiner;
          this._engine._loggedBcBalances.lastMiner = finalBlock.getMiner();
          if (this._engine._loggedBcBlocks.indexOf(finalBlock.getHash()) < 0) {
            this._engine._loggedBcBlocks.push(finalBlock.getHash());
            if (!this._engine._loggedBcBalances[finalBlock.getMiner()]) {
              this._engine._loggedBcBalances[finalBlock.getMiner()] = Math.round(finalBlock.getNrgGrant());
            } else {
              this._engine._loggedBcBalances[finalBlock.getMiner()] += Math.round(finalBlock.getNrgGrant());
            }
          }
          const newBlocks = finalBlock.getBlockchainHeadersCount ? finalBlock.getBlockchainHeadersCount() : 0;
          this._engine._blockStats.write(`${Math.floor(new Date() / 1000)},${finalBlock.getTimestamp()},${finalBlock.getHeight()},${finalBlock.getHash()},${finalBlock.getDistance()},${finalBlock.getDifficulty()},${finalBlock.getTotalDistance()},${finalBlock.getMiner().slice(2, 30)},${this._engine._loggedBcBalances[finalBlock.getMiner()]},${finalBlock.getTxsList().length},${Math.round(finalBlock.getNrgGrant())},${newBlocks},${Math.floor(new Date() / 1000) - finalBlock.getTimestamp()},${finalBlock.getMiner() === previousMiner ? 1 : 0},2\n`);
        }
      }

      this._logger.info(`[] -> [] reached global state across all connected chains -> ${currentHeight} <- monitoring ${this._PEER_QUARANTINE.length} sessions`);

      if (BC_BIND_PEER) {
        this._logger.info(`[] -> [  ] released binding to peer: ${BC_BIND_PEER}`);
        BC_BIND_PEER = false;
      }

      // MMM
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(evalBlock.getHeight(), 10));
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialsync`, 'complete');

      await this._engine.persistence.reorgBlockchain({
        chainState: this._chainState,
        reorgTo: true,
        toBlock: evalBlock
      });
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.range.lowest.height`, parseInt(evalBlock.getHeight(), 10) - 3);
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${parseInt(evalBlock.getHeight(), 10)}:${tn}`);
      await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerheader`, 'complete');
      await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeerdata`, 'complete');
      await this._engine.reorgTxPendingPool();

      if (BC_PRUNE_DB) {
        const reorgBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
        if (reorgBlock && parseInt(finalValidBlocks[0].getHeight(), 10) > parseInt(reorgBlock.getHeight(), 10)) {
          const comp = await this._engine.persistence.pruneFromBlock(finalValidBlocks[0], BC_PRUNE_DB_DEPTH, 20);
          if (comp && !isNaN(comp)) {
            this._multiverseCompressions = this._multiverseCompressions + comp;
          }
        }
      }

      const roverList = [];
      for (let key of this._engine._knownRovers) {
        roverList.push(key);
      }
      await this._engine.miningOfficer.newRoveredBlock(roverList, false, this._engine._blockCache, true, this._engine._knownFullBlocksCache, this._engine._emblemPerformance);

      if (this._engine._blockQueue.length() > 0) {
        this._engine._blockQueue.process();
      }

      return;
    } else if (invalidData) {
      this._logger.error(`invalid data, clear data from waypoint on local disk`);
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
      // get the current best block hash + BC_MAX_DATA_RANGE
      const nextHeight = min(currentHeight + BC_MAX_DATA_RANGE, parseInt(highestBlock.getHeight(), 10) + parseInt(latestBlock.getHeight(), 10));
      let nextHighestBlock = await this._engine.persistence.getBlockByHeight(nextHeight);
      this._logger.info(`highestBlock: ${highestBlock.getHeight()} nextHighestBlock: ${nextHighestBlock}`);
      let data = '';
      if (!nextHighestBlock) {
        data = [highestBlock.getHeight(), parseInt(highestBlock.getHeight(), 10) + BC_MAX_DATA_RANGE];
      } else {
        data = [highestBlock.getHeight(), parseInt(nextHighestBlock.getHeight(), 10) + 1];
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

    this._engine._emitter.on('requestBlockRange', async (range, openLink) => {

      if (!openLink) {
        openLink = 1;
      }

      if (this._engine._blockQueue && this._engine._blockQueue.length() > 0 && openLink !== 1) {
        this._logger.info(`emptying ${this._engine._blockQueue.length()} blocks from queue`);
        this._engine._blockQueue.process();
      }

      this._dataObjectCache.clear();

      if (this._blockRangeUpperBound && this._blockRangeLowerBound && this._blockRangeUpperBound.height === range[0] && this._blockRangeLowerBound.height === range[1]) {
        debug(`range request is already set in rover`);
      }

      const now = Math.floor(Date.now() / 1000);
      const givenConnection = range && range.length > 2 ? range[2] : false;
      const addr = addressToHost(`${givenConnection.remoteAddress}:${givenConnection.remotePort}`);
      let currentPeer;
      //let limit = openLink
      let limit = givenConnection ? BC_REQUEST_PEERS : openLink;
      let hasAddress = false;
      if (givenConnection) {
        hasAddress = addr;
        currentPeer = await this._engine.persistence.get('bc.sync.initialpeer');
        if (currentPeer !== null && parseInt(currentPeer.getExpires(), 10) >= Number(new Date()) && currentPeer.getAddress() !== addr) {
          this._logger.info(`range request pending waypoint ${currentPeer.getAddress()} unlock: ${parseInt(currentPeer.getExpires(), 10) - Number(new Date())}, before next range...`);
          return;
        } else if (currentPeer && currentPeer.getAddress() === addr) {
          currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
        }
      } else {
        currentPeer = await this._engine.persistence.get('bc.sync.initialpeer');
        if (currentPeer !== null && parseInt(currentPeer.getExpires(), 10) >= Number(new Date()) && currentPeer.getAddress() !== addr) {
          this._logger.info(`pending waypoint ${currentPeer.getAddress()} unlock: ${parseInt(currentPeer.getExpires(), 10) - Number(new Date())}...`);
          await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
          return;
        }
      }

      if (!range) {
        this._logger.info(`no range provided from request block range event`);
        return Promise.resolve(false);
      }

      if (range[0] === range[1]) {
        range[1] = range[1] - 3;
        this._logger.warn(`range window cannot be of size 0 <- ${range[0]} !== ${range[1]}`);
      }

      this._blockRangeUpperBound = { height: range[0], hash: false };
      this._blockRangeLowerBound = { height: range[1], hash: false };
      let lowest = max(2, range[1]);
      let highest = max(lowest + 1, range[0]);
      let ignoreHost = false;
      const difference = highest - lowest;

      if (highest !== lowest) {
        debug(`requesting block range from ${this._discovery.connections.length} waypoints <- highest: ${highest}, lowest: ${lowest}`);
        await this._engine.persistence.delUtxoUnmount();

        const payload = encodeTypeAndData(MESSAGES.GET_DATA, [lowest - 1, highest]);
        if (DISABLE_IPH_TEST) {
          debug(`DISABLE_IPH_TEST === true this means the range requests from any peer should not be ignored highest: ${highest} lowest: ${lowest}`);
        }

        if (this._discovery.connections) {
          let t = 0;
          let p = 0;
          let pass = false;

          if (range[2]) {
            const remoteConnection = range[2];
            const address = `${remoteConnection.remoteAddress}:${remoteConnection.remotePort}`;
            const host = addressToHost(address);
            if (this._PEER_BLACKLIST.indexOf(host) < 0 && this._PEER_QUARANTINE.indexOf(host) < 0) {
              debug(`host cleared for evaluation ${host}`);
              pass = true;
            } else {
              debug(`host NOT cleared for evaluation ${host}`);
              await this._engine.persistence.del('bc.sync.initialpeer');
            }
          }

          if (range[2] && pass) {
            const remoteConnection = range[2];
            const address = `${remoteConnection.remoteAddress}:${remoteConnection.remotePort}`;
            const host = addressToHost(address);
            const sendToAnyPeer = true;
            const sendToPool = BC_MINER_POOL ? host === BC_MINER_POOL : true;
            // LDL
            if (this._PEER_RECORD[host]) {
              this._PEER_RECORD[host].lastSeenHash = "NA";
            }

            ignoreHost = host;

            debug(`creating direct request -> agnostic: ${sendToAnyPeer} p: ${p}`);
            if (sendToAnyPeer && p < 1 && this._PEER_BLACKLIST.indexOf(address) < 0 && this._PEER_BLACKLIST.indexOf(host) < 0 && this._PEER_QUARANTINE.indexOf(addressToHost(address)) < 0 && sendToPool) {
              // LDL
              debug(`sending range request to address ${address} from ${lowest} to ${highest}`);
              p += 1;
              await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.req.range`, `${highest}:${lowest}:${now}:${host}`);
              const sent = await this.qsend(remoteConnection, payload);
              if (sent && sent.success) {
                // LDL
                debug(`range request sent ${lowest} -> ${highest}`);
              } else {
                this.addToQuarantine(address, 'connection failed range request adding to extended...', true);
                this._logger.warn(`failed range request ${lowest} -> ${highest}...resending to range...`);
                this._engine._emitter.emit('requestBlockRange', [range[0], range[1]], 3);
                return;
              }
              // request is complete
              return;
            } else if (!sendToAnyPeer) {
              // LDL
              this._logger.info(`waypoint unavailable range request to address ${address} from ${lowest} to ${highest}`);
            }

            if (limit === 1) {
              return;
            }
          }

          if (this._discovery.connections.length > 0) {
            // the goal of this for loop is to find a peer willing to send the range
            // once a range is recieved currentPeer gets assigned and breaks the for loop
            // gradually the timeout to request increases to give previous requests a chance to respond
            const connections = shuffle(this._discovery.connections);
            const hosts = this.getWaypointRecords();
            this._logger.info(`sending range request from ${lowest} to ${highest} for ${connections.length}`);

            for (const remoteConnection of connections) {

              //const remoteConnection = this._discovery.connections[Math.floor(Math.random() * this._discovery.connections.length)]
              const address = `${remoteConnection.remoteAddress}:${remoteConnection.remotePort}`;
              const hasCurrentPeer = true;
              const host = addressToHost(address);

              if (host === ignoreHost) {
                continue;
              }

              const sendToPool = BC_MINER_POOL ? host === BC_MINER_POOL : true;

              if (hosts.indexOf(host) < 0) {
                debugRequest(`waypoint ${host} with no record`);
              }

              if (sendToPool && p < limit && this._PEER_QUARANTINE.indexOf(host) < 0 && this._PEER_BLACKLIST.indexOf(host) < 0 && this._PEER_BLACKLIST.indexOf(address) < 0) {
                p += 1;
                debugRequest(`current peer handling broadcast range request to address from ${lowest} to ${highest}`);
                await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.req.range`, `${highest}:${lowest}:${now}:${host}`);
                const t = p === 1 ? 0 : getRandomWithinRange(900, 1500);

                if (t > 0) {
                  await this.qsend(remoteConnection, payload);
                } else {
                  await this.qsend(remoteConnection, payload);
                }
              } else if (!hasCurrentPeer && sendToPool && p < 1 && this._PEER_QUARANTINE.indexOf(host) < 0 && this._PEER_BLACKLIST.indexOf(host) < 0 && this._PEER_BLACKLIST.indexOf(address) < 0) {
                p += 1;
                this._logger.info(`broadcasting range request to address ${address} from ${lowest} to ${highest} with window ${t} and p: ${p}`);
                // continue requesting
                await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.req.range`, `${highest}:${lowest}:${now}:${host}`);
                await this.qsend(remoteConnection, payload);
              } else {
                debugRequest(`unable to make range request for ${lowest} to ${highest}`);
                if (p > 0) {
                  return;
                }
              }
            }
          } else {
            this._logger.warn(`no available connections <- local machine cannot reach Overline waypoints to make request ${lowest} -> ${highest}`);
          }
        } else {
          this._logger.warn(`no available connections`);
        }
      } else {
        debugRequest(`no connections to request range of ${lowest} ${highest}`);
      }
    });
    /* Start multiverse sync */
    this._discovery.on('connection', async (conn, peer) => {

      const address = conn.remoteAddress + ':' + conn.remotePort;

      try {
        // pass connection to connection pool
        // create peer sync group <- sort peers by best block
        // sync backwards from top to bottom if a peer fails switch
        // begin syncing after pool size
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
        // get highest block
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
        if (conn && conn.setNoDelay) {
          ///conn.setNoDelay(true)
        }
        conn.setMaxListeners(30);
        conn.pipe(framer.decode(FRAMING_OPTS).once('error', e => {
          this._logger.error(`Error while decoding length-prefixed packed, e: ${e.message}`);
        })).on('data', async data => {

          const dataHash = crypto.blake2bl(data.slice(0, 64));
          if (this._dataObjectCache.has(dataHash)) {
            saved++;
            debug(`data hash already in cached (${this._dataObjectCache.length}): ${dataHash}, saved: ${saved}, conn: ${conn.remoteAddress} `);
            return;
          }

          if (this._PEER_BLACKLIST.indexOf(addressToHost(address)) < 0 && this._PEER_EXTENDED_QUARANTINE.indexOf(addressToHost(address)) && this._PEER_QUARANTINE.indexOf(addressToHost(address)) < 1) {
            this._dataObjectCache.set(dataHash, true);
          }
          // schedule blocks priority
          if (data) {
            const type = data.slice(0, 7).toString('ascii');

            if (type === MESSAGES.BLOCK) {
              await this.peerDataHandler(conn, peer, data);
              return;
            }

            //// prioritize tx data
            if (type === MESSAGES.TX) {
              await this.peerDataHandler(conn, peer, data);
              return;
            }

            // queue get requests for data
            if (type === MESSAGES.GET_DATA) {
              await this.peerDataHandler(conn, peer, data);
              return;
            }

            //// queue get requests for data
            if (type === MESSAGES.DATA) {
              await this.peerDataHandler(conn, peer, data);
              return;
            }
          }
          await this.peerDataHandler(conn, peer, data);
        });
        conn.once('error', async err => {
          debug(`waypoint disconnected ${address}`);

          // check if we were syncing with that peer and if so remove the initial peer
          if (address) {
            const h = addressToHost(address);
            const initialPeer = await this._engine.persistence.get('bc.sync.initialpeer');
            if (initialPeer && initialPeer.getAddress) {
              const a = addressToHost(initialPeer.getAddress());
              debug(`waypoint removed as sync partner ${address}`);
              if (a === h) {
                await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
                await this._engine.persistence.reorgBlockchain();
                await this._engine.reorgTxPendingPool();
              }
            }
          }
          debug(err);
        });
        conn.once('exit', err => {
          debug('connection closed');
          // LDL
          debug(err);
          try {
            const idrn = conn.id ? conn.id : peer.id;
            if (this._discovery.dht._peersSeen[idrn]) {
              delete this._discovery.dht._peersSeen[idrn];
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
          }
          // if either rover sync is not complete or quorum has not been achieved
        } else if (DISABLE_IPH_TEST) {
          /*
           * AT First Waypoint Handshake
           * Waypoints compare initial blocks if reorg is not already set
           */
          if (this._PEER_BLACKLIST.indexOf(addressToHost(address)) > -1) {
            // this._logger.error(`peer attempting to handshake: ${address}`)
            this._discovery.removePeer(this._discovery.hash, peer);
            return;
          }

          const synced = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
          if (!synced || synced === 'pending' && !BC_MINER_BOOT || BC_MINER_BOOT && this._connectionCount < 5) {
            return;
          }

          this._connectionCount++;

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
        this._logger.warn(`waypoint sent critical error ${address} moving to quarantine`);
        this._PEER_BLACKLIST.push(addressToHost(address));
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
      this._engine._emitter.on('sendblock', msg => {
        let type = MESSAGES.BLOCK;
        if (msg.type !== undefined) {
          type = msg.type;
        }
        const payload = encodeTypeAndData(type, msg.data);
        const addr = msg.connection.remoteAddress + ':' + msg.connection.remotePort;
        process.nextTick(() => {
          this.qsend(msg.connection, payload).then(() => {
            debug('block uplink complete!');
          }).catch(err => {
            this._logger.warn('critical block rewards feature is failing with this error');
            this._logger.error(err);
          });
        });
      });

      /*
       * Engine announces emits block to be sent to peers
       */
      this._engine._asyncEmitter.on('getblocks', async msg => {

        const payload = encodeTypeAndData(MESSAGES.GET_BLOCKS, [msg.from, msg.to]);
        //const tasks = shuffle(this._discovery.connections).map((conn) => {
        for (const conn of shuffle(this._discovery.connections)) {
          try {
            const addr = conn.remoteAddress + ':' + conn.remotePort;
            // TODO: during a reorg this needs to get reset if the block already seen is now again recent
            await this.qsend(conn, payload);
          } catch (e) {
            debug(e);
          }
        }
        //})
        //await Promise.all(tasks)
        this._logger.info(`requesting blocks ${msg.from} to ${msg.to}`);
      });

      /*
       * Engine announces emits block to be sent to peers
       */
      this._engine._asyncEmitter.on('announceblock', async msg => {
        const payload = encodeTypeAndData(MESSAGES.BLOCK, msg.data);
        //const tasks = shuffle(this._discovery.connections).map((conn) => {
        for (const conn of shuffle(this._discovery.connections)) {
          try {
            const addr = conn.remoteAddress + ':' + conn.remotePort;
            if (msg.data.getHash !== undefined) {
              // TODO: during a reorg this needs to get reset if the block already seen is now again recent
              if (this._noDoubleSent.has(addressToHost(addr) + msg.data.getHash())) {
                debug(`waypoint ${addr} previously notified of block ${msg.data.getHash()}`);
              } else {
                this._noDoubleSent.set(addressToHost(addr) + msg.data.getHash(), 1);
                this._engine._knownBlocksCache.set(msg.data.getHash(), true);
                await this.qsend(conn, payload);
                debug(`block sent to ${addressToHost(addr)}`);
              }
            }
          } catch (e) {
            debug(e);
          }
        }
        //})
        this._logger.info(`broadcasting block ${msg.data.getHeight()} to ${this._discovery.connections.length} waypoints`);
        //await Promise.all(tasks)
      });
      /*
       * Event fired in engine when a new TX is accepted via RPC or as resend of such received pending TX
       */
      this._engine._asyncEmitter.on('announceTx', async msg => {

        const payload = encodeTypeAndData(MESSAGES.TX, msg.data);
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

        for (const conn of shuffle(this._discovery.connections)) {

          try {
            //const tasks = shuffle(this._discovery.connections).map((conn) => {
            const addr = conn.remoteAddress + ':' + conn.remotePort;
            // !!! IMPORTANT No double sent is not set here as TX hashes can be the same and so resubmission is valid !!!
            if (msg.conn && conn.remoteAddress === msg.conn.remoteAddress && conn.remotePort === msg.conn.remotePort) {
              // DEBUG
              debug(`preventing resending tx ${msg.conn.remoteAddress}`);
            } else if (this._noDoubleSent.has(addressToHost(addr) + msg.data.getHash())) {
              debug(`preventing tx echo ${addressToHost(addr)}`);
            } else {
              await this.qsend(conn, payload);
              debug(`tx send to ${addressToHost(addr)}`);
            }
          } catch (e) {
            debug(e);
          }
        }

        //return Promise.all(tasks).then(() => {
        this._logger.info('transactions announced to network!');
        //}).catch((err) => {
        //  this._logger.warn('connection failure when announcing to network')
        //  this._logger.error(inspect(err))
        //})
        return;
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

      this._logger.info('opened active waypoint registry');
    });
    /*
     * PEER SEEDER
     * Seeks out new potential Overline nodes (run by wise people).
     */
    let seenPeers = [];
    this._discovery._seeder = discovery.seeder();
    this._discovery._seeder.setMaxListeners(30);
    this._discovery._seeder.on('peer', peer => {

      if (this._discovery.connected > BC_MAX_CONNECTIONS + 300) {
        debug('waypoint about bound <- ' + this._discovery.connected + ' connections');
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
      }

      if (seenPeers.length > 50000) {
        seenPeers.unshift();
      }
    });
    this._discovery._seeder.start();

    this._discovery._seeder.on('update', update => {
      debug(update);
    });

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
      debug(`unknown type received from waypoint: ${type}`);
      return;
    }

    let currentPeer = false;
    const iph = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeerheader`);
    // if the iph status is running and the message type is not a block or an announced tx ignore the message
    if (DISABLE_IPH_TEST === false) {
      if (iph === 'running' &&
      // The following types are not permitted while IPH is running:
      type !== MESSAGES.BLOCK && type !== MESSAGES.HEADER && type !== MESSAGES.HEADERS) {
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
        await this.processPeerEvaluations();
        return;
      }
    }
    /// OVERLINE:BC ///////////////////////////////////////////////////////
    //
    //    MESSAGES.BLOCK
    //
    //    Peer sent block
    //
    /// ///////////////////////////////////////////////////////
    if (type === MESSAGES.BLOCK) {

      const address = conn.remoteAddress + ':' + conn.remotePort;
      const host = addressToHost(address);
      const rawBlock = str.slice(10);
      const block = BcBlock.deserializeBinary(rawBlock);
      let newPeerAssigned = false;
      let currentTimeSeconds = Math.floor(Date.now() / 1000);

      if (this._PEER_QUARANTINE.indexOf(addressToHost(address)) > -1 && addressToHost(address) !== BC_BIND_PEER) {
        // LDL
        debug(`waypoint ${address} in quarantine and attempted to send BLOCK`);
        debug(`[ATTEMPT] <- OL BLOCK ${block.getHeight()} ${block.getHash()} ${block.getDifficulty()} <- ${address} <- ${block.getMiner()} reason: ${this._PEER_RECORD[host].lastQuarantineReason}`);
        return;
      }

      if (this._PEER_EXTENDED_QUARANTINE.indexOf(addressToHost(address)) > -1 && addressToHost(address) !== BC_BIND_PEER) {
        // LDL
        debug(`waypoint ${address} in quarantine and attempted to send BLOCK`);
        debug(`[EXTENDED ATTEMPT] <- OL BLOCK ${block.getHeight()} ${block.getHash()} ${block.getDifficulty()} <- ${address} <- ${block.getMiner()} ${this._PEER_RECORD[host].lastQuarantineReason}`);
        return;
      }

      debug(`[] <- OL BLOCK ${block.getHeight()} ${block.getHash()} ${block.getDifficulty()} <- ${address} <- ${block.getMiner()}`);

      if (BC_MINER_POOL) {
        if (host != BC_MINER_POOL) {
          this._logger.info(`BC_MINER_POOL enabled, ignoring block ${block.getHeight()} : ${block.getHash().slice(0, 16)}... from ${host}`);
          return;
        } else {
          this._logger.info(`BC_MINER_POOL enabled, received block ${block.getHeight()} : ${block.getHash().slice(0, 16)}... from ${host}`);
        }
      }

      if (block && parseInt(block.getHeight(), 10) === 303400 && block.getHash().indexOf('d210de42a745ae87fc9e31e947cdc51b655') > -1) {
        return;
      } else if (block && parseInt(block.getHeight(), 10) === 303401 && block.getHash().indexOf('9f2ec991664602327ff21c1caf68756f35') > -1) {
        return;
      }

      if (!BC_MINIMUM_HEADER_TEST || BC_MINIMUM_HEADER_TEST === 0) {
        delete this._blockHeaderTest;
        this._logger.info(`_XX_ BLOCK ${block.getHeight()} ___ BC_MINIMUM_HEADER_TEST === 1, yielding block from waypoint ${block.getHeight()} ${block.getDifficulty()}`);
        return;
      } else if (BC_MINIMUM_HEADER_TEST === 1) {
        delete this._blockHeaderTest;
      }

      if (BC_MINER_POOL && BC_MINER_POOL === host) {
        delete this._blockHeaderTest;
      } else if (!BC_BIND_PEER && this._blockHeaderTest && this._blockHeaderTest.length < BC_MINIMUM_HEADER_TEST && block && block.getHeight) {
        this._logger.info(`____ OL BLOCK ${block.getHeight()} ___  ${block.getHash()} ${block.getDifficulty()} min: ${BC_MINIMUM_HEADER_TEST}`);
        this._blockHeaderTest.push(block);
        return;
      } else if (!BC_BIND_PEER && this._blockHeaderTest && this._blockHeaderTest.length >= BC_MINIMUM_HEADER_TEST) {
        this._logger.info(`[] <- OL BLOCK ${block.getHeight()} ${block.getHash()} ${block.getDifficulty()} `);
        this._blockHeaderTest.sort((a, b) => {
          if (parseInt(a.getHeight(), 10) > parseInt(b.getHeight(), 10)) {
            return -1;
          }
          if (parseInt(a.getHeight(), 10) < parseInt(b.getHeight(), 10)) {
            return 1;
          }
          return 0;
        });
        // tests are complete
        delete this._blockHeaderTest;
      } else if (this._blockHeaderTest && BC_BIND_PEER && BC_BIND_PEER === addressToHost(address)) {
        delete this._blockHeaderTest;
      }

      if (!block || !block.getHeight || !block.getHash) {
        return;
      }

      if (new BN(block.getDistance()).lt(new BN(209578459912602)) && parseInt(block.getHeight(), 10) < 3090000) {
        this._logger.warn(`invalid sequence detected ${block.getHeight()} ${block.getMiner()}`);
        if (parseInt(block.getHeight(), 10) < 5) {
          return;
        }
        this._PEER_BLACKLIST.push(addressToHost(address));
        return;
      }

      this._processedBlocks++;

      if (parseInt(block.getHeight(), 10) < 174091) {
        this._PEER_BLACKLIST.push(addressToHost(address));
        return;
      }

      if (BC_BIND_PEER && host !== BC_BIND_PEER) {
        this._logger.info(`waypoint ${address} ignoring peer, bound to ${BC_BIND_PEER}`);
        return;
      }

      if (this._PEER_BLACKLIST.indexOf(host) > -1) {
        // LDL
        debug(`waypoint ${address} in BLACKLIST and attempted to send BLOCK`);
        return;
      }

      if (!this._PEER_RECORD[host]) {
        this._PEER_RECORD[host] = {
          host: host,
          port: conn.remotePort,
          quarantined: 0,
          lastSeenHash: 0,
          blocksBelowLatest: 0,
          badBlocks: 0,
          goodBlocks: 0,
          lastBlockHeight: parseInt(block.getHeight(), 10),
          lastQuarantineReason: "NA",
          lastSeen: false
        };
      }

      const blockPassesTest = true;
      if (!blockPassesTest) {
        this._PEER_RECORD[host].badBlocks++;
        this.addToQuarantine(address, 'waypoint sent block triggering failed rover test');
        this._logger.info(`block ${block.getHeight()}: ${block.getHash().slice(0, 12)}... failed rover test`);
        return;
      }

      // determine the health of the peer
      if (this._PEER_RECORD[host].blocksBelowLatest > 6) {
        this._logger.info(`waypoint removed from table <- too many old blocks ${host}`);
        this._PEER_BLACKLIST.push(host);
        return;
      } else if (this._PEER_RECORD[host].badBlocks > 600) {
        this._logger.info(`waypoint quarantined <- too many invalid blocks ${host}`);
        debug(`PQ WARNING: 13 for ${addressToHost(address)}`);
        this.addToQuarantine(address, 'maximum number of invalid blocks sent by waypoint');
        return;
      }

      this._PEER_RECORD[host].lastSeen = Date.now();

      if (BC_MINIMUM_HEADER_TEST === 1) {
        this._logger.warn(`BC_MINIMUM_HEADER_TEST === 1 <- high risk for waypoint sync failure`);
      }

      const dataHash = crypto.blake2bl(str);
      // block hash has not been seen and its not the genesis block
      if (!this._SEEN_BLOCKS_MEMORY[block.getHash()] && parseInt(block.getHeight(), 10) !== 1) {
        //this._SEEN_BLOCKS_MEMORY[block.getHash()] = Math.floor(Date.now() / 1000)
        debug(`new block ${block.getHeight()}, from waypoint: ${address}, processed blocks ${this._processedBlocks} miner: ${block.getMiner()}`);

        // determine if we are evaluating peer performance, if true do not put block and increment peer timer
        this._SEEN_BLOCKS_MEMORY[dataHash] = Math.floor(Date.now() / 1000);
        this._SEEN_BLOCKS_MEMORY[block.getHash()] = Math.floor(Date.now() / 1000);

        if (parseInt(block.getHeight(), 10) > this._highestRequestedRangeHeight) {
          this._highestRequestedRangeHeight = parseInt(block.getHeight(), 10);
        }

        if (Object.keys(this._SEEN_BLOCKS_MEMORY).length > 1000) {
          for (let member of Object.keys(this._SEEN_BLOCKS_MEMORY)) delete this._SEEN_BLOCKS_MEMORY[member];
        }
      } else {
        return;
      }

      // check if the current waypoint sync has expired
      await this._engine.persistence.processPeerExpiration();
      // if the waypoint has expired initial peer will be null
      const initialpeer = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      const synced = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
      // run an isolated check on teh block itself
      const isolatedValidation = isValidBlock(block);
      if (!isolatedValidation) {
        // LDL
        debug(`invalid block ${block.getHeight()} : ${block.getHash()}`);
        this._PEER_RECORD[host].invalidBlocks++;
        // this waypoint sent a malformed block but another peer may send the right one
        delete this._SEEN_BLOCKS_MEMORY[block.getHash()];
        if (this._PEER_QUARANTINE.indexOf(host) < 0) {
          this.addToQuarantine(host, `malformed ${BC_SUPER_COLLIDER} block`);
        }
        return;
      }

      if (synced !== 'complete' && initialpeer) {

        await this._engine.persistence.saveBlock(block);
        await this._engine.persistence.putBlock(block, 0, BC_SUPER_COLLIDER, {
          asHeader: false,
          fromWaypoint: true,
          saveHeaders: true
        });
        return;
      }

      // used later in MESSAGES.DATA to decrease READS
      this._temporaryBlockStore[block.getHash()] = block;
      // await this._engine.persistence.saveTxsForBlock(block)

      //const hold = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.requesthold`)
      const hold = false;
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

        const latestBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);

        if (latestBlock && latestBlock.getHeight() > 1 && block.getPreviousHash() === block.getHash()) {

          const latestBlockChildSum = childrenHeightSum(latestBlock);
          const newBlockChildSum = childrenHeightSum(block);
          this._logger.info(`block ${block.getHeight()} did not increase weight`);
          if (latestBlockChildSum - 30 > newBlockChildSum) {
            this._logger.info(`weight too low ${latestBlockChildSum - newBlockChildSum} <- ${latestBlock.getHeight()} <> ${block.getHeight()}`);
            this.addToQuarantine(conn.remoteAddress, `weight of child sum for latest block below local latest`, true);

            const waypointKey = conn.remoteAddress + latestBlock.getHash();
            if (!this._engine._peerRequestCache.has(waypointKey)) {
              this._engine._peerRequestCache.set(waypointKey, true);
              this._engine._emitter.emit(`sendblock`, { data: block, connection: conn });
            }
            return;
          }
        }

        this._noDoubleSent.set(addressToHost(address) + block.getHash(), 1);

        if (latestBlock) {

          const latestBlockChildSum = childrenHeightSum(latestBlock);
          const newBlockChildSum = childrenHeightSum(block);

          if (latestBlock.getTimestamp() + 160 > currentTimeSeconds && latestBlockChildSum - 10 > newBlockChildSum && synced === 'complete' || latestBlock.getTimestamp() + 160 > currentTimeSeconds && latestBlock.getHeight() - 30 > block.getHeight() && synced === 'complete') {
            this._logger.info(`weight too low <- ${latestBlock.getHeight()} <> ${block.getHeight()}`);
            this.addToQuarantine(address, `weight of latest child block and/or main chain height ${latestBlock.getHeight()} is higher than given ${block.getHeight()}`);
            const waypointKey = conn.remoteAddress + latestBlock.getHash();
            if (!this._engine._peerRequestCache.has(waypointKey)) {
              this._engine._peerRequestCache.set(waypointKey, true);
              this._engine._emitter.emit(`sendblock`, { data: block, connection: conn });
            }
            return;
          }
        }

        let highestKnownHeight = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
        if (!highestKnownHeight) {
          highestKnownHeight = parseInt(block.getHeight(), 10);
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, highestKnownHeight);
        }

        if (latestBlock.getTimestamp() + 160 > currentTimeSeconds && synced === 'complete' && highestKnownHeight && parseInt(highestKnownHeight, 10) - 30 > parseInt(block.getHeight(), 10)) {
          this._logger.info(`weight is low <- ${highestKnownHeight} <> ${block.getHeight()} yielding block...`);
          //this.addToQuarantine(address, `block is more than 30 blocks lower than highest new height`)
          const waypointKey = conn.remoteAddress + block.getHash();
          this._engine._emitter.emit(`sendblock`, { data: block, connection: conn });
          return;
        } else if (latestBlock.getTimestamp() + 60 > currentTimeSeconds && latestBlock.getHeight() + 4 < highestKnownHeight) {
          this._logger.info(`setting block as new edge`);
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, block.getHeight());
        }

        this._logger.info(`OL BLOCK ${block.getHeight()} : ${block.getHash()} ${block.getDifficulty()}`);

        if (currentPeer && Number(new Date()) > parseInt(currentPeer.getExpires(), 10)) {
          debug(`current waypoint stale on receiving <- ${block.getHeight()}`);
          if (currentPeer.getAddress() === addressToHost(address)) {
            debug(`current peer has not responded to range request yielding block ${block.getHeight()}`);
            this.addToQuarantine(address, `current waypoint has not be released for block`);
            return;
          }

          await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
          currentPeer = false;
        }

        if (!currentPeer && this._processedBlocks > 2 && synced === 'complete' && this._processedBlocks > 2) {
          debug(`node is considered ready for blocks`);
          let highestKnownHeight = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
          if (highestKnownHeight) {
            highestKnownHeight = parseInt(highestKnownHeight, 10);
          }

          if (highestKnownHeight && highestKnownHeight + 1 === block.getHeight() || highestKnownHeight && highestKnownHeight + 2 === block.getHeight()) {
            this.broadcastNewBlock(block);
          }

          if (highestKnownHeight && highestKnownHeight < parseInt(block.getHeight(), 10)) {
            await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(block.getHeight(), 10));
          }
        } else {
          if (currentPeer) {
            const time = Number(new Date());
            if (new BN(time).gt(new BN(currentPeer.getExpires()))) {
              this._logger.info(`waypoint request window exceeds block range`);
            } else {
              if (addressToHost(currentPeer.getAddress()) === addressToHost(address)) {
                debug(`block waiting for queue to clear ${block.getHeight()}`);

                if (highestKnownHeight && highestKnownHeight < parseInt(block.getHeight(), 10)) {
                  await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(block.getHeight(), 10));
                }

                await this._engine.persistence.saveBlock(block);
                await this._engine.persistence.putBlock(block, 0, BC_SUPER_COLLIDER, {
                  asHeader: false,
                  fromWaypoint: true,
                  saveHeaders: true
                });

                return;
              } else {
                debug(`waiting for waypoint queue to clear ${block.getHeight()}`);
                return;
              }
            }
          }
        }

        debug(`iph is not running -> emit block ${block.getHeight()}`);
        const options = {
          fullBlock: true,
          alreadyAnnounced: false,
          sendOnFail: false,
          iph: iph,
          ipd: ipd,
          handleAsNewPeer: newPeerAssigned
        };
        debug(options);

        this._PEER_RECORD[host].lastBlockHeight = parseInt(block.getHeight(), 10);
        this._PEER_RECORD[host].goodBlocks++;

        // only use set immediate after the node has completed initial sync
        const uepoch = Math.floor(new Date() / 1000);
        if (!currentPeer && synced && synced === 'complete' && this._processedBlocks > 2) {
          // this._SEEN_BLOCKS_MEMORY[parseInt(block.getHeight(), 10)] = 1
          debug(`sending block to engine -> ${block.getHeight()}`);

          // EMIT BLOCK FROM PEER
          await this._engine.persistence.saveBlock(block);
          await this._engine.persistence.putBlock(block, 0, BC_SUPER_COLLIDER, { asHeader: false, fromWaypoint: true, saveHeaders: true });
          //await this._engine.blockFromPeerQueue({conn: conn, newBlock: block, options: options, alreadyBroadcasted: false})
          await this._engine.blockFromPeer({ conn: conn, newBlock: block, options: options, alreadyBroadcasted: false });

          if (uepoch % getRandomWithinRange(25, 50) === 0) {
            const payload = encodeTypeAndData(MESSAGES.GET_CONFIG, new Config());
            const result = await this.qsend(conn, payload);
            if (result.success) {
              debug('successful config update sent to waypoint');
            } else {
              this._logger.warn(utilFormat('qsend result = %o', result));
            }
          }
          return;
        } else {
          if (currentPeer && currentPeer.getAddress() === addressToHost(address) && Number(new Date()) < parseInt(currentPeer.getExpires(), 10)) {
            highestKnownHeight = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
            if (highestKnownHeight) {
              highestKnownHeight = parseInt(highestKnownHeight, 10);
            }

            const remain = Math.floor((parseInt(currentPeer.getExpires(), 10) - Number(new Date())) / 1000);
            this._logger.info(`yielding block ${block.getHeight()} during chain sync (r: ${remain})`);
            await this._engine.persistence.saveBlock(block);
            await this._engine.persistence.putBlock(block, 0, BC_SUPER_COLLIDER, {
              asHeader: false,
              fromWaypoint: true,
              saveHeaders: true
            });
            return;
          } else if (currentPeer && Number(new Date()) > parseInt(currentPeer.getExpires(), 10)) {
            debug(`stale waypoint eval <- ${block.getHeight()} : ${block.getHash()}`);
            await this._engine.persistence.saveBlock(block);
            await this._engine.persistence.putBlock(block, 0, BC_SUPER_COLLIDER, { asHeader: false, fromWaypoint: true, saveHeaders: true });
            await this._engine.blockFromPeer({ conn: conn, newBlock: block, options: options });
            //await this._engine.blockFromPeerQueue({conn: conn, newBlock: block, options: options})
          } else if (this._processedBlocks < 9) {
            this._logger.info(`boot up sequence detected ${block.getHeight()} : ${block.getHash()} of ${this._processedBlocks} processed blocks`);
            await this._engine.persistence.saveBlock(block);
            await this._engine.persistence.putBlock(block, 0, BC_SUPER_COLLIDER, { asHeader: false, fromWaypoint: true, saveHeaders: true });
            await this._engine.blockFromPeer({ conn: conn, newBlock: block, options: options });
            //await this._engine.blockFromPeerQueue({conn: conn, newBlock: block, options: options})
          } else if (!currentPeer && synced === 'pending' && hold) {
            this._logger.info(`waypoint search yielded <- ${block.getHeight()} : ${block.getHash()}`);
            await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.sync.requesthold`);
            return;
          } else if (!currentPeer && synced === 'pending') {
            debug(`waypoint search detected ${block.getHeight()} : ${block.getHash()}`);
            const d = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);
            const l = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
            const p = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initalpeer`);
            if (l && !p && parseInt(block.getHeight(), 10) > parseInt(l.getHeight(), 10) && this._PEER_QUARANTINE.indexOf(addressToHost(address)) < 0) {
              if (d) {
                const currentHeight = parseInt(d.split(':')[0], 10);
                const currentTime = Date.now() - parseInt(d.split(':')[1], 10);
                // within 50 blocks or below 12 seconds of last change
                if (block.getHeight() - 50 < currentHeight || currentTime < 26000) {
                  debug(`waypoint search not approved from current height ${currentHeight} at ${block.getHeight()} : ${block.getHash()}`);
                  return;
                }
                debug(`waypoint search approved ${block.getHeight()} : ${block.getHash()} with cost in time ${currentTime}`);
              } else {
                debug(`waypoint search approved ${block.getHeight()} : ${block.getHash()} without time cost estimate`);
              }
              await this._engine.persistence.saveBlock(block);
              await this._engine.persistence.putBlock(block, 0, BC_SUPER_COLLIDER, { asHeader: false, fromWaypoint: true, saveHeaders: true });
              //await this._engine.blockFromPeerQueue({conn: conn, newBlock: block, options: options})
              await this._engine.blockFromPeer({ conn: conn, newBlock: block, options: options });
            }
          } else {
            debug(`yielding ${block.getHeight()} : ${block.getHash()}`);
          }
          // EMIT TO BLOCK FROM PEER
        }
        return;
      } else {
        const options = { fullBlock: true, sendOnFail: false, iph: iph, ipd: ipd, handleAsNewPeer: true };
        debug('event->putblock tracing ipd and iph');
        debug(options);
        // EMIT TO BLOCK FROM PEER
        await this._engine.persistence.saveBlock(block);
        await this._engine.persistence.putBlock(block, 0, BC_SUPER_COLLIDER, { asHeader: false, fromWaypoint: true, saveHeaders: true });
        await this._engine.blockFromPeerQueue({ conn: conn, newBlock: block, options: options });
      }

      return;

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
      //    MESSAGES.FEED -> Overline
      //
      //    Peer sent ephemeral feed
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.FEED) {

      /// OVERLINE ///////////////////////////////////////////////////////
      //
      //    MESSAGES.GET_FEED -> Overline
      //
      //    Peer requests returns ephemeral feed
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.GET_FEED) {
      const address = conn.remoteAddress + ':' + conn.remotePort;
      // no parameters in this request
      const messages = this._txPendingPool.getEphemeralFeedMessages(0, 1000);
      const payload = encodeTypeAndData(MESSAGES.FEED, this._txPendingPool.slice());
      const result = await this.qsend(conn, payload);
      if (result && result.success === true) {
        debug(`successful GET_FEED response sent to ${addressToHost(address)} (total: ${messages.length}`);
      } else {
        debug(`failed GET_ response to ${address} from: ${from} to: ${to}`);
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
      const to = min(from + BC_MAX_DATA_RANGE, parseInt(latestBlock.getHeight(), 10));
      this._logger.info(`GET_BLOCKS: retrieving requested blocks from range from: ${from} -> ${to}`);

      const blockList = await this._engine.persistence.getBlocksByRange(from, to, BC_SUPER_COLLIDER, {
        asBuffer: true,
        cached: false
      });
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
      } else {
        if (BC_MINER_POOL) {
          this._logger.info(`sending ${onlyBlocks.length} blocks to respond to request for ${from} -> ${to} range`);
        }
      }
      const payload = encodeTypeAndData(MESSAGES.BLOCKS, onlyBlocks);
      const result = await this.qsend(conn, payload);
      if (result.success === true) {
        debug('successful update sent to waypoint');
      }
      // Waypoint Sends Challenge Block
    } else if (type === MESSAGES.GET_SOLUTION) {
      return;
      const parts = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]));
      const rawBlock = parts[1];
      const block = BcBlock.deserializeBinary(rawBlock);
      this._engine._emitter.emit('putblock', {
        data: block,
        connection: conn
      });
    } else if (type === MESSAGES.SOLUTION) {
      // TODO is this used / sent anywhere? if so add MESSAGES key
      return;
      const parts = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]));
      const rawBlock = parts[1];
      const block = BcBlock.deserializeBinary(rawBlock);
      this._engine._emitter.emit('putblock', {
        data: block,
        options: {
          sendOnFail: false
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
      // Depricated until OT
      return;
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
          cached: false,
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
          cached: false,
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
      // Depricated until OT
      return;

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
      if (!currentPeer) {
        debug('currentPeer is not defined');
      }

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
          // await this._engine.persistence.put(`bc.block.${headers[i].getHeight()}`, headers[i])
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
            this._logger.info(`unable to complete request`);
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
          currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
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
            latestHeightRaw = parseInt(dataLatestStr.split(':')[0], 10);
          }

          const reorgFromRaw = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.reorgfrom`);
          if (reorgFromRaw && reorgFromRaw.getHeight && new BN(reorgFromRaw.getHeight()).gt(new BN(latestHeightRaw))) {
            latestHeightRaw = parseInt(reorgFromRaw.getHeight(), 10);
          }

          const latestHeightShifted = parseInt(latestHeightRaw, 10) - 2;
          const latestBlock = await this._engine.persistence.get('bc.block.latest');
          if (!latestBlock) {
            this._logger.warn(`Couldn't get 'bc.block.latest' in processPeerEvaluations`);
          }
          const from = latestHeightShifted - 5;
          const to = min(latestHeightShifted + BC_MAX_DATA_RANGE, parseInt(latestBlock.getHeight(), 10));
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
            this._logger.info(`unable to complete data transmit`);
          }
        }
      }
      /// OVERLINE:BC ///////////////////////////////////////////////////////
      //
      //    MESSAGES.GET_DATA
      //
      //    Peer requests get data for tx hashes
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.GET_DATA) {

      if (this._engine._blockQueue && this._engine._blockQueue.length && this._engine._blockQueue.length() > 0) {
        this._engine._blockQueue.process();
      }
      const address = conn.remoteAddress + ':' + conn.remotePort;
      debug(`received GET_DATA request from waypoint ${address}`);
      const highestKnownHeight = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
      const latestBlock = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
      const parts = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]));
      const [, ...rawHeights] = parts;
      let high = rawHeights[1];
      let low = rawHeights[0];
      if (high && new BN(high).lt(new BN(low))) {
        const l = low;
        low = high;
        high = l;
      }

      if (high > parseInt(latestBlock.getHeight(), 10) + 300) {
        const peer = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
        if (peer) {
          this._logger.info(`received request from waypoint which cannot be completely fulfilled...`);
          //return
        } else {
          debug(`received request from waypoint ${address} which cannot be completely fulfilled`);
        }
      }

      let from = max(2, parseInt(low, 10)); // shift the window by six to confirm overlap
      let to = min(from + BC_MAX_DATA_RANGE, parseInt(latestBlock.getHeight(), 10));
      let highest = highestKnownHeight ? parseInt(highestKnownHeight, 10) : to;
      const synced = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);

      if (parseInt(latestBlock.getHeight(), 10) + 1000 < high && synced === 'pending') {
        debug(`received GET_DATA request from waypoint ${address} while actual highest ${highest} is much higher`);
        return;
      }

      if (from !== to) {
        if (new BN(from).gt(new BN(to))) {
          const hold = from;
          from = to;
          to = hold;
          debug(`GET_DATA request adjusted so assert from ${from} < to ${to} === true`);
        }
      }

      debug(`waypoint ${address} RES>GET_DATA request low ${low} -> ${high}`);

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
        debug(`PQ WARNING: 14 for ${addressToHost(address)}`);
        this.addToQuarantine(address, 'waypoint received maximum number of requests for specific block window');
        this._logger.info(`peer has recieved maximum number of requests in this block window ${requestWindowNumber}`);
        return;
      }

      debug(`M.GET_DATA: getting blocks data from range from: ${from} -> ${to}, request window: ${requestWindow}`);
      let onlyBlocks = [];
      let validBlocks = [];
      // if range request is just one block sen
      if (from === to) {
        debug(`GET_DATA from ${from} equals to ${to}`);
        const onlyBlock = await this._engine.persistence.getBlocksByHeight(from, BC_SUPER_COLLIDER, {
          asBuffer: true,
          cached: false
        });
        if (onlyBlock) {
          onlyBlocks = onlyBlocks.concat(onlyBlock);
        }
      } else {
        let blockList = await this._engine.persistence.getBlocksByRange(from, to, BC_SUPER_COLLIDER, {
          asBuffer: true,
          asSet: false,
          cached: false,
          searchUp: true
        });

        if (!blockList || !Array.isArray(blockList)) {
          blockList = await this._engine.persistence.getBlocksByRange(from, to, BC_SUPER_COLLIDER, {
            asBuffer: true,
            asSet: false,
            cached: false
          });
          if (!blockList || !Array.isArray(blockList)) {
            this._logger.warn(`could not getBlocksByRange(${from}, ${to}) while handling RES>GET_DATA message`);
            return Promise.resolve(false);
          }
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

      if (validBlocks.length !== onlyBlocks.length) {
        this._logger.warn(`${onlyBlocks.length - validBlocks.length} blocks removed from transmission`);
      }

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
      /// OVERLINE:BC ///////////////////////////////////////////////////////
      //
      //    MESSAGES.DATA
      //
      //    Peer sends structured data (block and TX, orderbook, FIX)
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.DATA) {

      const rawBlocks = str.slice(10, str.length);
      let blocks = BcBlocks.deserializeBinary(rawBlocks).getBlocksList();
      await this.processDataMessage(conn, blocks, { innerCall: false });
      return;
      /// OVERLINE ///////////////////////////////////////////////////////
      //
      //    MESSAGES.BLOCKS
      //
      //    Peer Sends Block List 0007, used for reorgs and determine reset condition, determine IPD/IPH status
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.BLOCKS) {
      // DEP until OVERLINE
      const address = conn.remoteAddress + ':' + conn.remotePort;
      this._logger.info(`received BLOCKS from waypoint ${address}`);
      const check = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.req.blocks`);
      if (!check) {
        this._logger.warn(`no check requested for block range`);
        return;
      } else {
        await this._engine.persistence.del(`${BC_SUPER_COLLIDER}.req.blocks`);
      }
      const parts = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]));
      const [, ...blocks] = parts;

      //const chunks = bufferSplit(str, Buffer.from(MSG_SEPARATOR[type]))
      //const rawBlock = chunks[1]
      //const receivedHeader = BcBlock.deserializeBinary(rawBlock)
      //console.log(receivedHeader.getHash())

      //const rawBlocks = str.slice(10, str.length)
      //let blocks = BcBlocks.deserializeBinary(blocks).getBlocksList()
      //console.log(blocks[0])
      //console.log(parts)
      //console.log(blocks)
      //console.log('------------')
      //console.log(blocks[0])

      for (const b of blocks) {
        const block = BcBlock.deserializeBinary(b);
        this._logger.info(`storing block ${block.getHeight()}:${block.getHash()}`);
        await this._engine.persistence.saveBlock(block);
        //await this._engine.persistence.putBlock(block, '0', BC_SUPER_COLLIDER)
      }

      return;
      // check if the first block claims to be a better branch than the block
      // check if its a valid sequence of blocks
      // if IPD/IPH is 'running' reject the submission
      if (ipd !== 'running' && iph !== 'running' && !DISABLE_IPH_TEST) {
        this._logger.warn(`received blocks range from waypoint ${address} while IPD: ${String(ipd)}`);
      } else if (ipd !== 'running' && iph !== 'running') {
        this._logger.warn(`would ignore received blocks range from waypoint ${address} while IPD: ${String(ipd)} however DISABLE_IPH_TEST is true`);
      }
      // if not latest block has been assigned reject the range
      if (!latestBlock) {
        this._logger.error(new Error(`cannot find 'bc.block.latest' while handling BLOCKS message from waypoint ${address}`));
        return false;
      }

      // peer cannot send range above the max data/block range
      if (blocks > BC_MAX_DATA_RANGE) {
        this._logger.warn(`${blocks.length} block range from waypoint ${address} exceeded BC_MAX_DATA_RANGE: ${BC_MAX_DATA_RANGE}`);
        //return false
      }

      try {
        let equalBranchHeights = true;
        let localBlock = false;
        const purposedLatestBlock = BcBlock.deserializeBinary(blocks[0]);

        if (!purposedLatestBlock) {
          this._logger.error(`unable to deserialize purposed block ${purposedLatestBlock.getHeight()}`);
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
          } else {
            // determine if there is an intersection to rebase on
            const currentHeightSelectHigh = parseInt(blocks[0].getHeight(), 10);
            const currentHeightSelectLow = parseInt(blocks[blocks.length - 1].getHeight(), 10);
            const currentBranch = await this._engine.persistence.getBlocksByRange(currentHeightSelectLow, currentHeightSelectHigh, BC_SUPER_COLLIDER, {
              asBuffer: true,
              cached: false
            });
          }
        } else {
          // cancel the evaluation of the new blocks
          debug(`purposed branch from waypoint is not improved latest block at height ${parseInt(purposedLatestBlock.getHeight(), 10)}`);
        }
      } catch (err) {
        this._logger.error(err);
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

      for (let i = 0; i < blockQueue.length; i++) {
        const newBlock = blockQueue[i];
        const blockHeight = newBlock.getHeight();
        const blockHash = newBlock.getHash();
        // if the block is not defined or corrupt reject the transmission
        debug(`loading newBlock: ${blockHeight}`);
        if (validDataUpdate === true && newBlock !== undefined && newBlock !== null) {
          if (new BN(newBlock.getHeight()).toNumber() === this._blockRangeLowerBound.height) {
            this._blockRangeLowerBound.hash = newBlock.getHash();
          } else if (new BN(newBlock.getHeight()).toNumber() === this._blockRangeUpperBound.height) {
            this._blockRangeUpperBound.hash = newBlock.getHash();
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
        await this._engine._persistence.putLatestBlock(highestBlock, BC_SUPER_COLLIDER, { chainState: this._engine.chainState });
        this._syncComplete = true;
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
        this._knownBlockSegments.clear();
        const now = Date.now();
        // !! ENABLE TO FULLY RECHECK THE CHAIN FROM ALL PEERS !!
        if (BC_LINKED_SYNC) {
          this._logger.warn(`BC_LINKED_SYNC is true setting new height to ${parseInt(highestBlock.getHeight(), 10) - 200}`);
          await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `2:${now}`);
        }
        // !!!!!!!!
        // process peer evaluations seeking better candidate
        debug('valid datate update is false requesting waypoint evaluations');
        await this.processPeerEvaluations();
      } else if (this._syncComplete === false) {
        // update the request to the latest height
        debug(`syncing multichain <- highest height:  ${currentHeight}`);
        const now = Date.now();
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${currentHeight}:${now}`);
        const nextHeight = min(currentHeight + BC_MAX_DATA_RANGE, parseInt(latestBlock.getHeight(), 10));
        debug(`requesting GET_DATA from highestLocalHeight: ${highestBlock.getHeight()} nextHeight for nextHighest: ${nextHeight}`);
        const data = [max(2, parseInt(highestBlock.getHeight(), 10)), nextHeight];

        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.req.range`, `${nextHeight}:${parseInt(highestBlock.getHeight(), 10)}:${Math.floor(now / 1000)}:na`);
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
        const now = Date.now();
        debug('if rovers are done syncing the miner can now be initiated');
        await this._engine.persistence.put('bc.sync.initialpeerheader', 'complete');
        await this._engine.persistence.put('bc.sync.initialpeerdata', 'complete');
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.data.latest`, `${currentHeight}:${now}`);
      } else {
        // get the current best block with data
        const highestBlock = await this._engine.persistence.getBlockByHeight(currentHeight, BC_SUPER_COLLIDER, { asHeader: false });
        const nextHeight = min(currentHeight + BC_MAX_DATA_RANGE, parseInt(latestBlock.getHeight(), 10));
        let nextHighestBlock = await this._engine.persistence.getBlockByHeight(nextHeight, BC_SUPER_COLLIDER, { asHeader: false });
        debug(`highestBlock: ${highestBlock.getHeight()} nextHighestBlock: ${nextHighestBlock}`);
        let data = [max(2, parseInt(highestBlock.getHeight(), 10)), nextHeight];
        await this._engine.persistence.put(`${BC_SUPER_COLLIDER}.req.range`, `${nextHeight}:${parseInt(highestBlock.getHeight(), 10)}:${Math.floor(Date.now() / 1000)}:na`);
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
      /// OVERLINE:BC ///////////////////////////////////////////////////////
      //
      //    MESSAGES.TX
      //
      //    Peer Sends TX
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.TX) {

      this._logger.debug('waypoint announced new TX');
      const address = `${conn.remoteAddress}:${conn.remotePort}`;

      if (this._engine._txPendingPool.isFull()) {
        return;
      }

      if (this._engine._txPendingPool.isWaypointThrottled(addressToHost(address))) {
        return { status: RpcTransactionResponseStatus.FAILURE, error: 'Not accepted by TX mem pool' };
      }

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
      const idj = JSON.parse(rawId);
      let blocks;
      switch (dimension) {
        case 'hash':
          // get full block with txs by blockHash
          blocks = await this._engine.persistence.getBlockByHash(idj, BC_SUPER_COLLIDER);
          break;

        case 'height':
          // get full block with txs by height
          blocks = await this._engine.persistence.getBlocksByHeight(idj, BC_SUPER_COLLIDER);
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
      this._logger.warn('waypoint sent full raw TXS message UNSUPPORTED');
      /// OVERLINE:BC ///////////////////////////////////////////////////////
      //
      //    MESSAGES.GET_RECORD
      //
      //    Waypoint requests it's record from another waypoint
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.GET_RECORD) {

      // use this to determine if node is running old version

      const address = conn.remoteAddress + ':' + conn.remotePort;
      const host = addressToHost(address);
      const t = Date.now();

      if (this._PEER_BLACKLIST.indexOf(host) > -1) {
        return;
      }
      if (this._PEER_QUARANTINE.indexOf(host) > -1) {
        return;
      }

      if (this._PEER_RECORD[host] && t - 2000 > this._PEER_RECORD[host].lastSeen) {
        const record = new Record();
        record.setVersion(BC_RECORD_VERSION);
        record.setHost(host);
        record.setPort(conn.remotePort);
        record.setLastSeen(this._PEER_RECORD[host].lastSeen);
        if (this._PEER_RECORD[host] && this._PEER_RECORD[host].lastSeenHash) {
          record.setLastSeenHash(this._PEER_RECORD[host].lastSeen);
        }

        this._PEER_RECORD[host].lastSeen = t;
        const payload = encodeTypeAndData(MESSAGES.RECORD, record);
        const result = await this.qsend(conn, payload);
        if (result.success && result.allSent) {
          debug('successful update sent to waypoint');
        }
      } else if (this._PEER_RECORD[host] && t >= this._PEER_RECORD[host].lastSeen) {
        this.addToQuarantine(host, 'waypoint has become too stale for recent block proposals');
        return;
      } else {
        this._PEER_RECORD[host] = {
          lastSeen: t,
          lastSeenHash: 0,
          blocksBelowLatest: 0,
          badBlocks: 0,
          goodBlocks: 0,
          lastBlockHeight: 0
        };
      }
      /// OVERLINE ///////////////////////////////////////////////////////
      //
      //    MESSAGES.RECORD
      //
      //    Waypoint sends reponse for record request
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.RECORD) {
      return;

      /// OVERLINE:BC ///////////////////////////////////////////////////////
      //
      //    MESSAGES.GET_CONFIG
      //
      //    Waypoint requests configuration
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.GET_CONFIG) {

      const conf = new Config();
      const services = [];
      conf.setVersion(BC_CONFIG_VERSION);

      // add the UI RPC service
      const uiService = new Service();
      uiService.setVersion(id);
      uiService.setUuid(SERVICES.BORDERLESS_RPC);
      uiService.setText("BC_UI_PORT:" + UI_PORT);
      services.push(uiService);

      // add the current network services
      const p2pService = new Service();
      p2pService.setVersion(id);
      p2pService.setUuid(SERVICES.AT_P2P);
      p2pService.setText(Object.keys(MESSAGES).join(','));
      services.push(p2pService);

      // add the services
      conf.setServicesList(services);

      const payload = encodeTypeAndData(MESSAGES.CONFIG, conf);
      const result = await this.qsend(conn, payload);
      if (result.success && result.allSent) {
        debug('successful update sent to waypoint');
      }

      /// OVERLINE:BC ///////////////////////////////////////////////////////
      //
      //    MESSAGES.CONFIG
      //
      //    Waypoint sends its configuration and available services
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.CONFIG) {

      try {
        const rawConfig = str.slice(10, str.length);
        const conf = Config.deserializeBinary(rawConfig);
        const address = conn.remoteAddress + ':' + conn.remotePort;
        for (let service of conf.getServicesList()) {

          // add services for waypoint
          if (service.getUuid() === SERVICES.BORDERLESS_RPC) {
            const port = service.getText();
            if (port.indexOf("BC_UI_PORT:") > -1) {
              // update the given service with the local host
              const brpc = port.replace("BC_UI_PORT:", conn.remoteAddress);
              if (this._BORDERLESS_RPC.length < 16 && this._BORDERLESS_RPC.indexOf(brpc) < 0) {
                this._BORDERLESS_RPC.push(brpc);
              }
            }
          }
        }
      } catch (e) {
        this._logger.error(e.message);
      }
      /// OVERLINE ///////////////////////////////////////////////////////
      //
      //    MESSAGES.PUT_CONFIG
      //
      //    Waypoint sends purposed new configuration update
      //
      /// ///////////////////////////////////////////////////////
    } else if (type === MESSAGES.PUT_CONFIG) {

      return;
    } else {
      this._logger.info(`unknown protocol flag received: ${type}`);
    }

    return Promise.resolve(true);
  }

  _broadcastUpdate(msg) {

    if (!this._discovery || !this._discovery._seeder) {
      debug(`no discovery module attached to broadcast update`);
      return;
    }

    if (!msg || !msg.data) {
      debug(`malformed update provided to discovery network`);
      return;
    }

    const payload = {
      uploaded: 0,
      downloaded: 0,
      left: 0
    };

    for (let k of Object.keys(msg)) {
      payload[k] = msg[k];
    }

    this._discovery._seeder.update(payload);
  }

  async broadcastNewBlock(block, latestHeight) {
    this._logger.debug(`broadcasting msg to peers, ${inspect(block.toObject())}`);
    let filters = [];
    //if (withoutPeerId) {
    //  if (withoutPeerId.constructor === Array) {
    //    filters = withoutPeerId
    //  } else {
    //    filters.push(withoutPeerId)
    //  }
    //}
    if (!latestHeight) {
      latestHeight = 0;
    }
    //if (block.getHeight() - 1 !== latestHeight) {
    this._engine._asyncEmitter.emit('announceblock', { data: block, filters: filters });
    //}
  }
}

exports.PeerNode = PeerNode;
exports.default = PeerNode;