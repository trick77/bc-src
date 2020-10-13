'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});


const path = require('path'); /**
                               * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.*
                               * This source code is licensed under the MIT license found in the
                               * LICENSE file in the root directory of this source tree.
                               *
                               * 
                               */

const { ensureDebugPath, DEBUG_DIR } = require('../../debug');
const BC_MINER_MUTEX = process.env.BC_MINER_MUTEX === 'true';
const debug = require('debug')('bcnode:rover:eth:network');
const assert = require('assert');
const dgram = require('dgram');
const { inspect } = require('util');
const EventEmitter = require('events');
const { DPT, RLPx, ETH, _util } = require('ethereumjs-devp2p');
const { default: EthereumCommon } = require('ethereumjs-common');
const EthereumBlock = require('ethereumjs-block');
const EthereumUtil = require('ethereumjs-util');
const Trie = require('merkle-patricia-tree');
const EthereumTx = require('ethereumjs-tx').Transaction;
const LRUCache = require('lru-cache');
const portscanner = require('portscanner');
const { promisify } = require('util');
const rlp = require('rlp');
const fs = require('fs');
const BN = require('bn.js');
const {
  min,
  aperture,
  init,
  isEmpty,
  last,
  map,
  pathOr,
  range,
  reverse,
  splitEvery,
  sort,
  max
} = require('ramda');

const ROVER_MEMORY_DEBUG_FILENAME = 'eth_rover_memory.csv';
const BC_LOW_POWER_MODE = process.env.BC_LOW_POWER_MODE === 'true';
ensureDebugPath(ROVER_MEMORY_DEBUG_FILENAME);
const wss = fs.createWriteStream(path.join(DEBUG_DIR, ROVER_MEMORY_DEBUG_FILENAME));
wss.write('timestamp,name,total,change\n');
let MEM = 0;
const biggest = {
  name: false,
  value: 0
};
const updateMem = id => {
  const used = process.memoryUsage().heapUsed;
  if (MEM === 0) {
    MEM = used;
  } else {
    const change = used - MEM;
    MEM = used;
    if (biggest.value < change) {
      biggest.name = id;
      biggest.value = change;
    }
    wss.write(`${Date.now()},${id},${used},${change}\n`);
  }
};
const logging = require('../../logger');
const { ROVER_RESYNC_PERIOD, ROVER_SECONDS_PER_BLOCK, getPrivateKey, semaphoreSwitch, getBacksyncEpoch, getIntervalDifficulty, shuffle } = require('../utils');
const { config } = require('../../config');
const { rangeStep } = require('../../utils/ramda');

// rover specific settings
// MAX BLOCK FETCH: https://github.com/ethereum/go-ethereum/blob/84f8c0cc1fbe1ab9c128555392a82ba609820fef/eth/downloader/downloader.go#L41
const ETH_INTERVAL_GET_HEADERS_MS = 2000;
const ETH_INTERVAL_GET_BLOCKS_MS = 800;
const ETH_IPD_TEST_BLOCKS = BC_MINER_MUTEX ? 3 : 4;
const ETH_MAX_FETCH_BLOCKS = config.rovers.maxFetchBlocks || 20;
const ETH_MAX_FETCH_HEADERS = config.rovers.maxFetchHeaders || 20;
const WAIT_FOR_PEERS = 1;
const BC_NETWORK = process.env.BC_NETWORK || 'main';
const ARCHIVE_EXPIRATION_SECONDS = 2 * 60 * 60; /* 2 hours */
const requiredBlocks = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK.eth);
const BC_ETH_ROVER_MINING_THRESHOLD = process.env.BC_ETH_ROVER_MINING_THRESHOLD || requiredBlocks;
// ethereum specific settings
const chainName = BC_NETWORK === 'ropsten' ? // eslint-disable-line
'ropsten' : 'mainnet';
const ec = new EthereumCommon(chainName, null, ['byzantium', 'constantinople', 'petersburg']);
const CHAIN_ID = 1;
const REMOTE_CLIENTID_FILTER = ['go1.5', 'go1.6', 'go1.7', 'quorum', 'pirl', 'ubiq', 'gmc', 'gwhale', 'prichain'];

const CHECK_BLOCK_NR = 4370000;
const CHECK_BLOCK = 'b1fcff633029ee18ab6482b58ff8b6e95dd7c82a954c852157152a7a6d32785e';
const ETH_1920000 = '4985f5ca3d2afbec36529aa96f74de3cc10a2a4a6c44f2157a57d2c6059a11bb';
const ETC_1920000 = '94365e3a8c0b35089c1d1195081fe7489b528a84b22199c916180db8b28ade7f';
const CHECK_BLOCK_HEADER = rlp.decode(Buffer.from('f9020aa0a0890da724dd95c90a72614c3a906e402134d3859865f715f5dfb398ac00f955a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347942a65aca4d5fc5b5c859090a6c34d164135398226a074cccff74c5490fbffc0e6883ea15c0e1139e2652e671f31f25f2a36970d2f87a00e750bf284c2b3ed1785b178b6f49ff3690a3a91779d400de3b9a3333f699a80a0c68e3e82035e027ade5d966c36a1d49abaeec04b83d64976621c355e58724b8bb90100040019000040000000010000000000021000004020100688001a05000020816800000010a0000100201400000000080100020000000400080000800004c0200000201040000000018110400c000000200001000000280000000100000010010080000120010000050041004000018000204002200804000081000011800022002020020140000000020005080001800000000008102008140008600000000100000500000010080082002000102080000002040120008820400020100004a40801000002a0040c000010000114000000800000050008300020100000000008010000000100120000000040000000808448200000080a00000624013000000080870552416761fabf83475b02836652b383661a72845a25c530894477617266506f6f6ca0dc425fdb323c469c91efac1d2672dfdd3ebfde8fa25d68c1b3261582503c433788c35ca7100349f430', 'hex'));

// TODO: Remove before production
const goodPeersFile = fs.readFileSync('./config/goodpeers.txt', 'utf8');
const goodPeers = goodPeersFile.split('\n').filter(p => {
  if (p.length > 8) {
    return p;
  }
});
let ARCHIVE_COUNTER = 0;
let GOOD_PEERS = [];
while (GOOD_PEERS.length < 630) {
  GOOD_PEERS.push(goodPeers[Math.floor(Math.random() * goodPeers.length)]);
}

GOOD_PEERS = GOOD_PEERS.map(addr => {
  return {
    address: addr.split(':')[0],
    tcpPort: addr.split(':')[1],
    udpPort: addr.split(':')[1]
  };
});
// let BOOTNODES = []
let BOOTNODES = ec.bootstrapNodes().map(node => {
  return {
    address: node.ip,
    udpPort: node.port,
    tcpPort: node.port
  };
});

shuffle(GOOD_PEERS).map((node, i) => {
  if (node.tcpPort === undefined) {
    node.tcpPort = node.udpPort;
  }
  node.udpPort = node.tcpPort;
  if (i < 500) {
    BOOTNODES.unshift(node);
  }
});

shuffle(config.rovers.eth.altBootNodes).map((node, i) => {
  if (node.tcpPort === undefined) {
    node.tcpPort = node.udpPort;
  }
  node.udpPort = node.tcpPort;
  if (i < 800) {
    BOOTNODES.push(node);
  }
});

BOOTNODES = shuffle(BOOTNODES);

const msgBroker = {
  headers: [],
  bodyRegister: [],
  archive: [],
  bodies: [],
  payloads: [],
  txs: [],
  pendingRequests: [],
  directRequests: [],
  msgTypes: {},
  validPeer: {},
  litePeer: {},
  performance: {},
  registry: {},
  lastUpdate: Math.floor(new Date() / 1000)
};

const DAO_FORK_SUPPORT = true;
let ws = false;
let peerSearch = false;

const DISCONNECT_REASONS = {};
// const DISCONNECT_REASONS = Object.keys(RLPx.DISCONNECT_REASONS)
//  .reduce((acc, key) => {
//    const errorKey = parseInt(RLPx.DISCONNECT_REASONS[key], 10)
//    acc[errorKey] = key
//    return acc
//  }, {})

const HOSTS = BOOTNODES.map(b => {
  return b.address;
});

if (process.env.BC_ROVER_DEBUG_ETH !== undefined) {
  ws = fs.createWriteStream('eth_peer_errors.csv');
}

if (process.env.BC_ROVER_ETH_PEER_SEARCH === 'true') {
  peerSearch = fs.createWriteStream('eth_peers.csv');
}

// TODO end extract this to config
const findAPortNotInUse = promisify(portscanner.findAPortNotInUse);

const getRandomRange = (min, max, num) => {
  if (!num) {
    num = 1;
  }
  return Math.floor((Math.random() * (max - min + 1) + min) / num);
};

const getPeerAddr = peer => `${peer._socket.remoteAddress}:${peer._socket.remotePort}`;
const getBootnodeObject = peer => {
  const addr = getPeerAddr(peer);
  return {
    address: addr.split(':')[0],
    udpPort: addr.split(':')[1],
    tcpPort: addr.split(':')[1]
  };
};

const isValidTx = tx => tx.validate(false);
const isValidBlock = (block, strict = true) => {
  try {
    debug(`isValidBlock(): block ${new BN(block.header.number).toNumber()} with ${block.transactions.length} txs`);
    const blockNumber = new BN(block.header.number).toNumber();
    if (BC_MINER_MUTEX) {
      return Promise.resolve(block);
    }
    if (!block.validateUnclesHash()) {
      debug(`isValidBlock(): block ${new BN(block.header.number).toNumber()} with ${block.transactions.length} txs, invalid uncle!`);
      // DEBUG
      return Promise.resolve(false);
    }

    if (!block.validateTransactions()) {
      //debug(`isValidBlock(): block transactions ${new BN(block.header.number).toNumber()} with ${block.transactions.length} txs, invalid class a txs!`)
      // DEBUG
      if (!block.transactions.every(isValidTx)) {
        //debug(`isValidBlock(): block ${new BN(block.header.number).toNumber()} with ${block.transactions.length} txs, invalid class b txs!`)
        // DEBUG
        return Promise.resolve(false);
      }
    }

    return Promise.resolve(block);
  } catch (err) {
    debug(err);
    console.trace(err);
    return Promise.resolve(false);
  }
};

const generateTxTrie = block => {
  if (BC_LOW_POWER_MODE || BC_MINER_MUTEX) {
    return Promise.resolve(block);
  }
  return new Promise((resolve, reject) => {
    const height = new BN(block.header.number).toNumber();
    return resolve(block);
  });
};

const manualTree = async rawTxs => {
  if (!rawTxs || rawTxs.length === 0) {
    return EthereumUtil.KECCAK256_RLP.toString('hex');
  }
  const trie = new Trie();
  //let i = 0
  //for (let r of rawTxs) {
  //  i++
  //  try {
  //    const rt = new EthereumTx(r).serialize()
  //  } catch (e) {
  //    console.log('failed at tx: ' + i)
  //    console.trace(e)
  //  }
  //}
  await Promise.all(rawTxs.map((t, i) => new Promise(resolve => {
    trie.put(rlp.encode(i), new EthereumTx(t).serialize(), resolve);
  })));
  return trie.root.toString('hex');
};

const isValidBlockTrie = async (blockWithTrie, strict = true) => {
  try {
    const height = new BN(blockWithTrie.header.number).toNumber();
    debug(`isValidBlockTrie(): block ${new BN(blockWithTrie.header.number).toNumber()}`);
    if (BC_LOW_POWER_MODE) {
      return Promise.resolve(blockWithTrie);
    }
    if (BC_MINER_MUTEX) {
      return Promise.resolve(blockWithTrie);
    }
    const purposedRoot = blockWithTrie.header.transactionsTrie.toString('hex');
    const trieRoot = await manualTree(blockWithTrie.transactions);
    return purposedRoot === trieRoot;
  } catch (err) {
    debug(`isValidBlockTrie(): block ${new BN(blockWithTrie.header.number).toNumber()}, invalid trie error!`);
    debug(err);
    return Promise.resolve(false);
  }
};
const validateBlock = (block, syncBlock = false) => {

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, 22000);
    try {

      const height = new BN(block.header.number).toNumber();
      const validBlockFramework = await isValidBlock(block);
      if (!validBlockFramework) {
        clearTimeout(timeout);
        return resolve(false);
      }

      if (syncBlock) {
        clearTimeout(timeout);
        return resolve(block);
      }

      const blockTrie = await generateTxTrie(block);
      if (!blockTrie) {
        clearTimeout(timeout);
        return resolve(false);
      }

      const trie = await isValidBlockTrie(blockTrie);
      if (!trie) {
        clearTimeout(timeout);
        return resolve(false);
      }

      clearTimeout(timeout);
      return resolve(blockTrie);
    } catch (err) {
      clearTimeout(timeout);
      debug(err);
      console.trace(err);
      return resolve(false);
    }
  });
};

const randomChoiceMut = arr => {
  const index = Math.floor(Math.random() * arr.length);
  const ret = arr[index];
  arr.splice(index, 1);
  return ret;
};

const compressBlock = block => {
  block.transactions.length = 0;
  block.txTrie.length = 0;
  delete block.transactions;
  delete block.txTrie;
  delete block._inBlockchain;
  delete block._common;
  block.transactions = [];
  block.txTrie = [];
  block.compressed = true;
  return block;
};

class Network extends EventEmitter {

  constructor(config) {
    super();

    const txCacheConf = {
      max: 3000
    };

    const fetchCacheConf = {
      max: 1000
    };

    const blockCacheConf = {
      max: 720, // full 3 hours of ETH blocks
      maxAge: 3 * 60 * 60 * 1000,
      noDisposeOnSet: true,
      dispose: (key, val) => {
        const k = String(key);
        this.storage.archiveOnly(k);
      }
    };

    let reportBelowMinPeer = true;
    let reportAboveMinPeer = false;

    this._logger = logging.getLogger(__filename);
    this._ipdTestComplete = false;
    this._ipdTestBlocks = [];
    this._forkDrops = {};
    this._msgTypes = {};
    this._minimumPeers = WAIT_FOR_PEERS;
    this._peers = [];
    this._rlpx = null;
    this._key = getPrivateKey();
    this._txCache = new LRUCache(txCacheConf);
    this._blocksCache = new LRUCache(blockCacheConf);
    this._fetchCache = new LRUCache(fetchCacheConf);
    this._blocksArchive = {};
    this._rangeToFetch = [];
    this._config = config;
    this._maximumPeers = 35 + (Math.floor(Math.random() * 5) + 1); // hard set to suggest devp2p
    this._blocksAbove = {};
    this._blocksToFetch = [];
    this._blockRangeUpperBound = false;
    this._engineSynced = false;
    this._blockRangeLowerBound = false;
    this._seekingSegment = [];
    this._initialResync = true;
    this._resetResync = true;
    this._seekingBlockSegment = false;
    this._invalidDifficultyCount = 0;
    this._reportSyncStatus = false;
    this._reportMiningThreshold = false;
    this._lowestBlockHeight = CHECK_BLOCK_NR;
    this._bestSeenBlockReceived = 0;
    this._dptFailed = 0;
    this._peersFailed = 0;
    this._syncCheckTimeout = setInterval(() => {

      const uniq = [];
      msgBroker.bodies = msgBroker.bodies.reduce((all, b) => {
        const hash = b.hash().toString('hex');
        if (uniq.indexOf(hash) < 0) {
          all.push(b);
          uniq.push(hash);
        }
        return all;
      }, []);

      const allPeers = [].concat(Object.values(msgBroker.validPeer));
      const peers = [].concat(Object.values(msgBroker.validPeer)).filter(peer => {
        if (!msgBroker.litePeer[getPeerAddr(peer)]) {
          return peer;
        }
      });

      const now = Math.floor(new Date() / 1000);
      if (now - msgBroker.lastUpdate > 930) {
        this._logger.warn(`rover connected to stale peers, restarting`);
        process.exit();
      }

      const dptPeers = this._dpt.getPeers();
      if (dptPeers.length < 3) {
        this._dptFailed++;
        if (this._dptFailed > 5) {
          this._logger.warn('unable to establish DPT table, restarting rover');
          process.exit();
        } else {
          this._logger.info('searching for stronger DPT nodes...');
        }
      }
      if (peers.length < 2) {
        this._peerFailed++;
        if (this._peerFailed > 8) {
          this._logger.warn('unable to establish peer connections table, restarting rover');
          process.exit();
        }
      }
      if (peers.length >= 2 && this._bestSeenBlock && this._peerFailed > 0) {
        this._peerFailed--;
      }
      if (Math.floor(Date.now() / 1000) % 2 === 0) {
        this._logger.info(`graph ${dptPeers.length}-dpt ${peers.length}-full ${allPeers.length - peers.length}-lite, m-${now - msgBroker.lastUpdate} | bh: ${!this._bestSeenBlock === true ? false : new BN(this._bestSeenBlock.header.number).toNumber()}, seek: ${this._seekingBlockSegment}, unfetch: ${this._blocksToFetch.length}, bodies: ${msgBroker.bodies.length}`);
        debug('heap consumption: ' + Math.floor((process.memoryUsage().heapTotal - process.memoryUsage().heapUsed) / 1000000) + 'mb');
      }
      if (this._bestSeenBlock) {
        const blockNumber = new BN(this._bestSeenBlock.header.number).toNumber();
        const randomPeer = peers[Math.floor(Math.random() * peers.length)];
        // DEBUG
        debug(`after new block current best block is ${blockNumber}`);
        if (this._initialResync && blockNumber > 0 && this._resetResync) {
          this._logger.info(`scheduling initial sync from block ${blockNumber}`);
          this._resetResync = false;
          this._initialResync = false;
          this.scheduleInitialSync(blockNumber);
        } else if (this._blocksToFetch.length < 1 && peers.length < WAIT_FOR_PEERS && reportBelowMinPeer) {
          reportAboveMinPeer = true;
          reportBelowMinPeer = false;
          this._logger.warn(`current full peers ${peers.length} below minimum ${WAIT_FOR_PEERS} <- reconnecting...`);
          process.exit();
        } else if (this._blocksToFetch.length < 1 && peers.length >= WAIT_FOR_PEERS && reportAboveMinPeer) {
          reportBelowMinPeer = true;
          reportAboveMinPeer = false;
          this._logger.warn(`current full peers ${peers.length} below minimum ${WAIT_FOR_PEERS}`);
        } else if (this._blocksToFetch.length > 0 && !this._seekingBlockSegment && peers.length >= WAIT_FOR_PEERS) {
          debug(`pending range detected with block segments to fetch ${this._blocksToFetch.length}`);
          this.sync();
        } else if (this._blocksToFetch.length > 0 && peers.length >= WAIT_FOR_PEERS && msgBroker.bodies.length < 1) {
          //} else if (this._blocksToFetch.length > 0 && peers.length >= WAIT_FOR_PEERS) {
          this._seekingBlockSegment = false;
          this._logger.info(`pending range detected with block segments to fetch ${this._blocksToFetch.length}, bodies are 0`);
          this.sync();
        } else if (this._blocksToFetch.length === 0 && msgBroker.bodies.length < 1 && this._seekingBlockSegment && peers.length >= WAIT_FOR_PEERS) {
          this._seekingBlockSegment = false;
          this.sync();
        }
      }
    }, 16900);

    this._edgeRequestInterval = setInterval(() => {
      if (this._blockRangeUpperBound && !this._blockRangeUpperBound.hash) {
        if (this._rangeToFetch.length > 0) {
          const r = this._rangeToFetch.pop();
          const higher = r[0]; // this._blockRangeUpperBound.height
          const lower = r[1]; // this._blockRangeLowerBound.height
          if (higher && lower) {
            this._blocksToFetch.push([higher, lower]);
          }
        }
      }
    }, 300000);

    this.on('newBlock', () => {
      if (this._bestSeenBlock) {
        const blockNumber = new BN(this._bestSeenBlock.header.number).toNumber();
        // DEBUG
        debug(`after new block current best block is ${blockNumber}`);
        if (this._initialResync && blockNumber > 0 && !this._seekingBlockSegment && this._resetResync) {
          this._logger.info(`scheduling initial sync from block ${blockNumber}`);
          this._initialResync = false;
          this._resetResync = false;
          this.scheduleInitialSync(blockNumber);
        }
      }
    });

    const restartTime = getRandomRange(60000, 2000000) + 60000 * 60 * 16;

    setTimeout(() => {
      this._logger.info('restarting <- rebuild DPT...');
      process.exit();
    }, restartTime);
  }

  get peers() {
    return this._peers;
  }

  get rlpx() {
    return this._rlpx;
  }

  get engineSynced() {
    return this._engineSynced;
  }

  set engineSynced(status) {
    this._engineSynced = status;
  }

  get initialResync() {
    debug(`InitialResync getter called with ${String(this._initialResync)}`);
    return this._initialResync;
  }

  set initialResync(status) {
    debug(`InitialResync setter called with ${String(status)}`);
    this._initialResync = status;
  }

  get resyncData() {
    return this._resyncData;
  }

  set resyncData(data) {
    this._resyncData = data;
  }

  get storage() {
    return {
      has: key => {
        if (this._fetchCache.has(key)) return false; // allow this block to be considered new
        if (key in this._blocksArchive) return false;
        if (this._blocksCache.has(key)) return true;
        return false;
      },
      cached: key => {
        return this._blocksCache.has(key);
      },
      set: (key, val) => {
        delete this._blocksArchive[key];
        return this._blocksCache.set(key, val);
      },
      get: key => {
        if (this._blocksCache.has(key)) return this._blocksCache.get(key);
        if (key in this._blocksArchive) {
          return {
            timestamp: this._blocksArchive[key],
            archived: true
          };
        }
      },
      del: key => {
        this._fetchCache.del(key);
        this._blocksCache.del(key);
      },
      archive: key => {
        this.storage.del(key);
        this._blocksArchive[key] = Math.floor(Date.now() * 0.001);
      },
      archiveOnly: key => {
        this._blocksArchive[key] = Math.floor(Date.now() * 0.001);
      },
      processExpirations: () => {
        const threshold = Math.floor(Date.now() * 0.001) - ARCHIVE_EXPIRATION_SECONDS;
        this._logger.info(`processing expirations in archive below ${threshold}`);
        let i = 0;
        for (const key in Object.keys(this._blocksArchive)) {
          if (this._blocksArchive[key] < threshold) {
            i++;
            delete this._blocksArchive[key];
          }
        }
        this._logger.info(`${i} expirations removed from archive`);
      },
      flush: key => {
        this._blocksCache.del(key);
        delete this._blocksArchive[key];
      }
    };
  }

  addPeer(peer) {
    if (!peer || !peer.endpoint) {
      return;
    }

    const host = peer.endpoint.address;
    const protocol = 'http';

    if (HOSTS.indexOf(host) > -1) {}
  }

  connect() {
    findAPortNotInUse(30304, 33663).then(port => {
      this._logger.info(`starting eth node at port: ${port}`);
      this.run(port);
    }).catch(err => {
      this._logger.error(err);
      this._logger.error('unable to find local network interface to listen on');
      process.exit(3);
    });
  }

  /*
   * sends the bounds of the block range ready for evaluation
   */
  setBlockRange(nextRange) {
    if (nextRange) {
      if (nextRange.length > 1) {
        if (nextRange[0] === nextRange[1]) {
          throw Error('cannot set block range of equivalent heights');
        }
      }
    }
    // if a block range should be evaluated on disk report it to the controller
    if (this._blockRangeUpperBound && this._blockRangeLowerBound && this._blockRangeUpperBound.hash && this._blockRangeLowerBound.hash) {
      // LDL
      debug(`setting block range upper hash ${this._blockRangeUpperBound.hash} lower hash ${this._blockRangeLowerBound.hash}`);
      this.emit('roverBlockRange', {
        roverName: 'eth',
        highestHeight: this._blockRangeUpperBound.height,
        lowestHeight: this._blockRangeLowerBound.height,
        highestHash: this._blockRangeUpperBound.hash,
        lowestHash: this._blockRangeLowerBound.hash
      });
      // unsset the bounds allowing the bounds to be changed
      this._blockRangeUpperBound = undefined;
      this._blockRangeLowerBound = undefined;
      // else if the block heights have not been found and nothing is pending their to resume the search, put the heights into their own segment
    } else if (this._blockRangeUpperBound && this.BlockRangeLowerBound && this._blocksToFetch.length < 1 && this._rangeToFetch.length < 1 && !this._seekingBlockSegment) {
      if (!this._blockRangeUpperBound.hash || !this._blockRangeLowerBound.hash) {
        const highest = this._blockRangeUpperBound.height;
        const lowest = this._blockRangeLowerBound.height;
        this._blockRangeUpperBound.height = highest;
        this._blockRangeLowerBound.height = lowest;
        this._blockRangeUpperBound.hash = undefined;
        this._blockRangeLowerBound.hash = undefined;
        this._blocksToFetch.push([highest, lowest]);
      }
    }
    // only set block range if there are no requests waiting to be fetched
    if (nextRange && nextRange.length > 1 && this._rangeToFetch.length < 1) {
      this._blockRangeUpperBound = { height: nextRange[0], hash: false };
      this._blockRangeLowerBound = { height: nextRange[1], hash: false };
    } else if (!this._blockRangeUpperBound && this._rangeToFetch.length > 0) {
      this._logger.info('block range upper bound not defined and range to fetch has a length greater than 0');
      const r = this._rangeToFetch.pop();
      this._blockRangeUpperBound = { height: r[0], hash: false };
      this._blockRangeLowerBound = { height: r[1], hash: false };
    }
  }

  requestBlockRange(blockRange) {

    if (blockRange && blockRange.length < 2) {
      this._logger.error('invalid block range length submitted');
      return;
    }

    let highest = blockRange[0];
    let lowest = blockRange[1];

    if (new BN(highest).lt(new BN(lowest))) {
      const hold = lowest;
      lowest = highest;
      highest = hold;
    }

    highest = min(lowest + ETH_MAX_FETCH_BLOCKS + 30, highest);
    if (this._seekingBlockSegment) {
      if (this._blocksToFetch.length === 0 && msgBroker.bodies.length === 0) {
        this._seekingBlockSegment = false;
      } else {
        this._logger.info(`received block range request ${blockRange[1]} -> ${blockRange[0]} (${blockRange[0] - blockRange[1]}) while seeking.`);
        return;
      }
    }
    this._logger.info(`received block range request ${blockRange[1]} -> ${blockRange[0]} (${blockRange[0] - blockRange[1]})`);

    if (this._blocksToFetch.length < 1 && msgBroker.bodies.length < 1) {
      this._logger.info(`range request queued for active sync ${lowest} -> ${highest} (${highest - lowest})`);
      this._blocksToFetch.push([highest, lowest]);
      this._rangeToFetch.length = 0;
      this._rangeToFetch.push([highest, lowest]);
      for (let i = lowest - 1; i < highest + 1; i++) {
        this._fetchCache.set(i, true);
      }
    } else {
      return;
    }

    if (blockRange) {
      const r = [highest, lowest];

      if (lowest < this._lowestBlockHeight) {
        // DEBUG
        this._logger.info(`setting new lowest block height ${this._lowestBlockHeight} -> ${lowest}`);
        this._lowestBlockHeight = lowest;
      }

      for (let i = lowest; i < highest + 1; i++) {
        this._fetchCache.set(i, true);
      }

      if (this._rangeToFetch.length > 0) {
        const prevHigh = this._rangeToFetch[0][0];
        const prevLow = this._rangeToFetch[0][1];

        if (prevHigh < highest || prevLow > lowest) {
          this._logger.info(`updated block range prevHigh: ${prevHigh} -> highest: ${r[0]} prevLow: ${prevLow} -> lowest ${lowest}`);
          this._rangeToFetch.length = 0;
          this._rangeToFetch.push(r);
        } else if (this._blocksToFetch.length < 1) {
          this._logger.info(`updated blocks to fetch lowest: ${lowest} -> highest: ${highest}`);
          this._blocksToFetch.push([highest, lowest]);
        }
      } else {
        // LDL
        this._logger.info(`updated block range lowest: ${lowest} -> highest: ${highest}`);
        this._rangeToFetch.length = 0;
        this._rangeToFetch.push(r);
      }
    }

    if (this._rangeToFetch.length > 0) {
      const rs = this._rangeToFetch.pop();
      this._blockRangeUpperBound = { hash: false, height: rs[0] };
      this._blockRangeLowerBound = { hash: false, height: rs[1] };

      for (let i = rs[1] - 1; i < rs[0] + 1; i++) {
        this._fetchCache.set(i, true);
      }

      this.getBlockchain(blockRange[1], blockRange[0]).then(() => {
        this._seekingBlockSegment = false;
      }).catch(from => {
        // LDL
        debug(`getBlockchain(): error thrown from ${from}`);
        this._seekingBlockSegment = false;
        if (isNaN(from)) {
          this._logger.error(from);
          this._seekingBlockSegment = false;
        } else {
          // DEBUG
          debug(`rerequesting blocks highest ${to} and lowest ${from}`);
          // DEBUG
          this._seekingBlockSegment = false;
        }
      });
    }
  }

  onNewTx(tx, peer) {
    return true; // TX evaluation not necessary until block
  }

  sync() {
    const peers = [].concat(Object.values(msgBroker.validPeer)).filter(peer => {
      if (!msgBroker.litePeer[getPeerAddr(peer)]) {
        return peer;
      }
    });

    if (msgBroker.archive.length > 200) {
      msgBroker.archive = msgBroker.archive.slice(100, 200);
    }

    if (msgBroker.payloads.length > 200) {
      msgBroker.payloads = msgBroker.payloads.slice(msgBroker.payloads.length - 50, msgBroker.payloads.length);
    }

    if (msgBroker.bodies.length > 300 && this._blocksToFetch.length < 1) {
      msgBroker.bodies = msgBroker.bodies.slice(msgBroker.bodies.length - 300, msgBroker.bodies.length);
    }

    if (peers.length >= WAIT_FOR_PEERS && !this._seekingBlockSegment && msgBroker.bodies < 1 && this._blocksToFetch) {
      if (this._blocksToFetch.length < 1 && this._rangeToFetch.length > 0) {
        const nextRange = this._rangeToFetch.pop();
        // DEBUG
        this._logger.info(`requesting block range ${nextRange}`);
        this._blocksToFetch.push(nextRange);
      }

      const numberBlocksToFetch = this._blocksToFetch.length;
      if (!this._reportSyncStatus && numberBlocksToFetch === 0 && !this._initialResync && !this._seekingBlockSegment && this._rangeToFetch.length < 1) {
        this._reportSyncStatus = true;
        // } else if (!this._reportSyncStatus && !this._reportMiningThreshold && this._blocksToFetch.length <= new BN(BC_ETH_ROVER_MINING_THRESHOLD).toNumber()) {
      } else if (!this._reportSyncStatus && !this._reportMiningThreshold && new BN(this._blocksToFetch.length).lte(new BN(BC_ETH_ROVER_MINING_THRESHOLD))) {
        this._reportMiningThreshold = true;
      } else if (!this._seekingBlockSegment && this._reportSyncStatus === true && !this._initialResync && this._blocksToFetch.length < 1 && this._rangeToFetch.length < 1) {
        this._initialResync = true; // !!! IMPORTANT !!! this must be set to false if rover sync status returns to false
        this._logger.info('reporting to rover manager <- all necessary segments resolved');
        this._reportSyncStatus = false;
        this._reportMiningThreshold = false;
        this.emit('reportSyncStatus', true);
        // this.emit('reportMiningThreshold', true)
      }

      if (this._blocksToFetch.length > 0) {
        const firstBatch = this._blocksToFetch.pop();
        // DEBUG
        // if there are no pending range request assume this is the requested range
        debug(`new block sync request ${firstBatch[1]}`);
        this.getBlockchain(firstBatch[1], firstBatch[0]).then(() => {
          this._seekingBlockSegment = false;
          debug(`setting first batch after getting blockchain ${firstBatch}`);
        }).catch(from => {
          if (isNaN(from)) {
            this._logger.error(from);
            this._seekingBlockSegment = false;
          } else {
            debug(`return failed segment request to queue: ${firstBatch}`);
            // DEBUG
            this._logger.error(from);
            this._seekingBlockSegment = false;
          }
        });
      }
    } else if (msgBroker.bodies.length > 0) {
      msgBroker.bodies.shift();
      // DEBUG
      debug(`yielding new fetch request for active requests ${msgBroker.bodies.length}`);
    }
  }

  onNewBlock(block, peer, isBlockFromInitialSync = false) {
    // updateMem('startonNewBlock'))
    // DEBUG
    if (!block || !block.header) {
      this._logger.error(new Error('malformed block provided to funciton'));
      return;
    }
    const blockNumber = new BN(block.header.number).toNumber();
    const blockHashHex = block.header.hash().toString('hex');
    let blockInRequestRange = false;
    const bestBlockNumber = parseInt(pathOr(Buffer.from('00', 'hex'), ['header', 'number'], this._bestSeenBlock).toString('hex'), 16);

    if (this._bestSeenBlock) {
      if (blockNumber > bestBlockNumber + 500) {
        this._logger.warn(`block number ${blockNumber} is beyond maximum best block range from ${bestBlockNumber} <- disconnect peer`);
        peer && peer.disconnect && peer.disconnect();
        return;
      }
    }

    if (this._blockRangeLowerBound && blockNumber === this._blockRangeLowerBound.height) {
      // the lower bound is now ready to be reported
      this._blockRangeLowerBound.hash = blockHashHex;
    } else if (this._blockRangeUpperBound && blockNumber === this._blockRangeUpperBound.height) {
      this._blockRangeUpperBound.hash = blockHashHex;
    }
    this.setBlockRange();

    if (this._blockRangeLowerBound) {
      const lower = this._blockRangeLowerBound.height;
      const upper = this._blockRangeUpperBound.height;
      if (blockNumber >= lower && blockNumber <= upper) {
        blockInRequestRange = true;
      }
    }

    // DEBUG
    debug(`onNewBlock called with hash: ${blockHashHex}`);
    let peerAddr = false;
    if (peer && peer._socket !== undefined) {
      peerAddr = getPeerAddr(peer);
    } else {
      return;
    }

    const blockTimestamp = new BN(block.header.timestamp).toNumber();
    debug(`block timestamp: ${blockTimestamp}`);
    let blockTimeThreshold = getBacksyncEpoch('eth');
    blockTimeThreshold = blockTimeThreshold - 21600;
    // double the threshold if it is requested
    if (blockInRequestRange) {
      blockTimeThreshold = blockTimeThreshold - 6600;
    }

    //if (new BN(blockTimestamp).lt(new BN(blockTimeThreshold))) {
    //  this._logger.warn(`block ${blockNumber} time ${blockTimestamp} is below the backsync threshold ${blockTimeThreshold}`)
    //  this.storage.set(blockHashHex, true)
    //  peer && peer.disconnect && peer.disconnect()
    //  return
    //}

    this.storage.set(blockHashHex, block);

    // DEBUG
    debug(`block ${blockHashHex} : ${blockNumber} from "${getPeerAddr(peer)}" best local ${bestBlockNumber}`);
    // IF PEER HAS SENT AN INVALID BLOCK DISCONNECT.
    let difficultyValid = true;
    const possiblyConsecutiveBlock = bestBlockNumber < blockNumber;
    if (possiblyConsecutiveBlock && this._bestSeenBlock && !isBlockFromInitialSync) {
      difficultyValid = block.header.validateDifficulty(this._bestSeenBlock);
      if (!difficultyValid) {
        debug('unlinked block difficulty invalid from current best block -> below best block height');
        // peer && peer.disconnect && peer.disconnect(RLPx.DISCONNECT_REASONS.USELESS_PEER)
        if (blockNumber < bestBlockNumber) {
          if (blockNumber < this._lowestBlockHeight) {
            debug('ignoring unlinked block received below best edge');
            if (new BN(blockTimestamp).lt(new BN(getBacksyncEpoch('eth')))) {
              // DEBUG
              debug(`awaiting block ${blockNumber} at epoch ${blockTimestamp}`);
              this._logger.warn('block request below multiverse epoch threshold...ignoring');
              return Promise.resolve(false);
            }
          }
        }
      }
    }

    if (Number(blockNumber) < Number(this._lowestBlockHeight) - 20000) {
      this._logger.warn(`unlinked block ${blockNumber} received is below the lowest block height minimum ${this._lowestBlockHeight}`);
      return;
    }

    this.emit(blockHashHex, block);
    // DEBUG
    debug(`new block difficulty: ${difficultyValid} current best block: ${bestBlockNumber} new block: ${blockNumber}`);
    if (difficultyValid && (blockNumber - bestBlockNumber === 1 || bestBlockNumber === 0)) {
      debug(`new block is new edge: ${bestBlockNumber} from: ${peerAddr}`);
      this._invalidDifficultyCount = 0;
      let nextBlock = blockNumber + 1;
      let bestSeenBlock = block;
      while (this._blocksAbove[nextBlock]) {
        bestSeenBlock = this._blocksAbove[nextBlock];
        delete this._blocksAbove[nextBlock];
        nextBlock = nextBlock + 1;
      }
      this._bestSeenBlock = bestSeenBlock;
      this._bestSeenBlockReceived = Math.floor(Date.now() * 0.001);
      this.emit('newBlock', { block, isBlockFromInitialSync });
    } else if (!difficultyValid && blockNumber === bestBlockNumber) {
      this._logger.info(`new block ${blockNumber} does not increment best seen as best seen block may be uncle`);
      this.emit('newBlock', { block: block, isBlockFromInitialSync });
    } else if (blockNumber > bestBlockNumber + 500) {
      this._logger.warn(`block number ${blockNumber} is beyond maximum best block range from ${bestBlockNumber}`);
      return;
    } else if (blockNumber > bestBlockNumber) {
      this.requestBlockRange([blockNumber, bestBlockNumber]);
      debug(`request fetch block range ${bestBlockNumber} to ${blockNumber}`);
      this._bestSeenBlock = block;
      this._bestSeenBlockReceived = Math.floor(Date.now() * 0.001);
      this.emit('newBlock', { block, isBlockFromInitialSync });
    } else {
      // DEBUG
      debug(`unable to attach block ${blockNumber} from ${peerAddr} to edge ${bestBlockNumber}`);
      // CHECK HERE TO SEE IF IT IS IN THE RANGE OF THE CURRENT BATCH REJECT OTHERWISE
      isBlockFromInitialSync = true;
      this.emit('newBlock', { block, isBlockFromInitialSync });
    }

    const peers = [].concat(Object.values(msgBroker.validPeer)).filter(peer => {
      if (!msgBroker.litePeer[getPeerAddr(peer)]) {
        return peer;
      }
    });
    // DEBUG
    debug(`peers: ${peers.length} initial sync blocks to fetch: ${this._blocksToFetch.length} syncing blockchain: ${this._seekingBlockSegment}`);
    // DEBUG
    debug('preparing to evaluate next initial request after new block');
  }

  scheduleInitialSync(knownBlock) {
    let blockIntervalsToRequest;
    // DEBUG
    debug('scheduleInitialSync called');

    if (this._blocksToFetch.length > 0) {
      this._logger.warn(`schedule initial sync run when ${this._blocksToFetch.length} segments remain`);
      return;
    }

    if (this.resyncData && !isEmpty(this.resyncData.getIntervalsList())) {
      this._logger.warn('scheduling sync from resync data');
      // sort intervals in reverse order
      const sortedIntervals = sort((a, b) => b.getFromBlock().getHeight() - a.getFromBlock().getHeight(), this.resyncData.getIntervalsList());
      blockIntervalsToRequest = [];
      for (const interval of sortedIntervals) {
        const fromBlockHeight = interval.getFromBlock().getHeight();
        const toBlockHeight = interval.getToBlock().getHeight();
        // if intervals spans more than ETH_MAX_FETCH_BLOCKS
        if (toBlockHeight - fromBlockHeight > ETH_MAX_FETCH_BLOCKS) {
          const tempIntervals = aperture(2, reverse(rangeStep(fromBlockHeight, ETH_MAX_FETCH_BLOCKS, toBlockHeight).concat(toBlockHeight)));
          blockIntervalsToRequest = blockIntervalsToRequest.concat(init(tempIntervals).map(([from, to]) => [from, to + 1]));
          if (last(tempIntervals)) {
            blockIntervalsToRequest.push(last(tempIntervals));
          }
        } else {
          blockIntervalsToRequest.push([toBlockHeight, fromBlockHeight]);
        }
      }
      const knownLatestBlock = this.resyncData.getLatestBlock();
      if (knownLatestBlock && Date.now() - knownLatestBlock.getTimestamp() > ROVER_SECONDS_PER_BLOCK.eth) {
        const knownLatestBlockHeight = knownLatestBlock.getHeight();
        const latestIntervals = [];
        if (knownBlock - knownLatestBlockHeight > ETH_MAX_FETCH_BLOCKS) {
          const tempIntervals = aperture(2, reverse(rangeStep(knownLatestBlockHeight, ETH_MAX_FETCH_BLOCKS, knownBlock).concat(knownBlock)));
          blockIntervalsToRequest = [last(tempIntervals)].concat(blockIntervalsToRequest);
          blockIntervalsToRequest = init(tempIntervals).map(([from, to]) => [from, to + 1]).concat(blockIntervalsToRequest);
        } else {
          blockIntervalsToRequest = [[knownBlock, knownLatestBlockHeight]].concat(blockIntervalsToRequest);
        }
        blockIntervalsToRequest = latestIntervals.concat(blockIntervalsToRequest);
      }
    } else {
      // DEBUG
      debug('scheduling sync from origin height');
      const count = ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK.eth;
      const from = Math.max(0, knownBlock - count + 1);
      const to = knownBlock;
      // DEBUG
      debug(`initial sync schedule is from ${from} to ${to}`);
      blockIntervalsToRequest = map(interval => [interval[0], interval[interval.length - 1]], splitEvery(ETH_MAX_FETCH_BLOCKS, reverse(range(from, to + 1))));
      // sets the lowest block height for given schedule
      // DEBUG
      debug(`blockIntervalsToRequest: ${from} - ${to}`);
    }
    // this._logger.info(`blockIntervalsToRequest: ${JSON.stringify(blockIntervalsToRequest)}`)
    this._blocksToFetch = blockIntervalsToRequest;
    // lowest height add 100  block cushion
    this._lowestBlockHeight = this._blocksToFetch[this._blocksToFetch.length - 1][1] - 20000000;
    // DEBUG
    debug(`lowest block height ${this._lowestBlockHeight}`);
    return Promise.resolve(true);
  }

  broadcastMessage(message, messageBody, peersToUse = 1) {
    const peers = [].concat(Object.values(msgBroker.validPeer)).filter(peer => {
      if (!msgBroker.litePeer[getPeerAddr(peer)]) {
        return peer;
      }
    });
    const performancePeers = Object.keys(msgBroker.performance);
    let speers = [];
    if (peers.length >= WAIT_FOR_PEERS) {
      speers = shuffle(peers);
      // DEBUG
      let i = 0;
      for (const peer of Object.values(speers)) {
        i++;
        if (i <= peersToUse) {
          debug(`sending message to peer ${getPeerAddr(peer)}`);
          this.sendMessage(peer, message, messageBody);
        }
      }
    }
  }

  sendMessage(peer, message, messageBody) {
    const eth = peer.getProtocols()[0];
    setTimeout(() => {
      eth.sendMessage(message, messageBody);
    }, getRandomRange(100, 1150));
  }

  getHeaders(from, to) {
    if (!from) throw Error('null value cannot be passed to get headers');
    // DEBUG
    debug(`getHeaders called from block height ${from}`);
    return new Promise(resolve => {
      let cycles = 0;
      let maxHeaders = 0;
      if (!to) {
        maxHeaders = ETH_MAX_FETCH_HEADERS + 1;
      } else {
        maxHeaders = to;
      }
      const _cycleGetHeaders = () => {
        cycles++;
        const peers = [].concat(Object.values(msgBroker.validPeer)).filter(peer => {
          if (!msgBroker.litePeer[getPeerAddr(peer)]) {
            return peer;
          }
        });
        debug(`getHeaders called with ${peers.length} peers `);
        if (peers.length >= WAIT_FOR_PEERS) {
          let message;
          if (isNaN(from)) {
            // DEBUG
            debug(`requesting hex header hash: ${from}`);
            message = [from, maxHeaders, 0, 0];
          } else {
            // DEBUG
            debug('using complex message');
            message = [from > 0 ? from : from + 1, maxHeaders, 0, 0];
            // DEBUG
            debug(`requesting from height ${message[0]} for ${message[1]} blocks`);
          }
          this.broadcastMessage(ETH.MESSAGE_CODES.GET_BLOCK_HEADERS, message, 1);
        }
      };
      const intervalRetry = setInterval(() => {
        if (cycles > 10) {
          clearInterval(intervalRetry);
        } else {
          _cycleGetHeaders();
        }
      }, getRandomRange(ETH_INTERVAL_GET_HEADERS_MS, ETH_INTERVAL_GET_HEADERS_MS + 1000));
      const eventKey = `headers:${String(from)}`;
      debug(`getHeaders() with eventKey: ${eventKey}`);
      this.once(eventKey, headers => {
        // updateMem('headersReceivedEvent')
        // DEBUG
        debug(`getHeaders "headers" once event fired with ${headers.length} headers`);
        clearInterval(intervalRetry);
        return resolve(headers);
      });
      _cycleGetHeaders();
    });
  }

  getBlock(header, returnHeaderOnError = false) {
    const currentPeers = [].concat(Object.values(msgBroker.validPeer)).filter(peer => {
      if (!msgBroker.litePeer[getPeerAddr(peer)]) {
        return peer;
      }
    });
    if (!header || !header.number) {
      this._logger.warn('invalid headeer format');
      return Promise.reject(new Error('invalid header format'));
    }
    const blockNumber = new BN(header.number).toNumber();
    const blockTimestamp = new BN(header.timestamp).toNumber();
    const headerHash = header.hash().toString('hex');
    let pass = false;
    let blockTimeThreshold = getBacksyncEpoch('eth');
    blockTimeThreshold = blockTimeThreshold - 21600;
    if (this._blockRangeUpperBound) {
      const h = this._blockRangeUpperBound.height;
      const l = this._blockRangeLowerBound.height;
      if (h >= blockNumber && l <= blockNumber) {
        pass = true;
      }
    }

    // DEBUG
    debug(`getBlock called pending events ${msgBroker.bodies.length}`);
    // DEBUG

    if (new BN(blockNumber).lt(new BN(this._lowestBlockHeight))) {
      if (returnHeaderOnError) return Promise.reject(header);
      this._logger.warn(`block request below multiverse height threshold ${this._lowestBlockHeight}`);
    }

    // double the threshold if it is requested
    if (pass) {
      blockTimeThreshold = blockTimeThreshold - 6600;
    }
    //if (new BN(blockTimestamp).lt(new BN(blockTimeThreshold))) {
    //  // DEBUG
    //  this._logger.warn(`block ${blockNumber} time ${blockTimestamp} is below the backsync threshold ${blockTimeThreshold}`)
    //  if (returnHeaderOnError) return Promise.reject(header)
    //  this._logger.error('block request below multiverse epoch threshold')
    //  return Promise.resolve(false)
    //}

    if (msgBroker.headers.indexOf(headerHash) > -1 && !this._fetchCache.has(blockNumber)) {
      debug(`requested header already polled and ${blockNumber} is not in fetchCache`);
    } else if (this._fetchCache.has(blockNumber)) {
      debug(`block ${blockNumber} directly requested`);
      this.storage.del(headerHash);
      // if (returnHeaderOnError) return Promise.reject(header)
      // return Promise.resolve(false)
    } else {
      msgBroker.headers.push(headerHash);
    }

    // DEBUG
    debug(`GET_BLOCK requesting block ${blockNumber} : ${headerHash}`);

    return new Promise(resolve => {
      const peers = [].concat(Object.values(msgBroker.validPeer)).filter(peer => {
        if (!msgBroker.litePeer[getPeerAddr(peer)]) {
          return peer;
        }
      });
      let cycles = 0;
      const _cycleGetBlock = () => {
        cycles++;
        const cyclePeers = [].concat(Object.values(msgBroker.validPeer)).filter(peer => {
          if (!msgBroker.litePeer[getPeerAddr(peer)]) {
            return peer;
          }
        });
        // recheck the cache just in case this block has already been found
        if (this.storage.has(headerHash) && !this._fetchCache.has(blockNumber)) {
          const storedBlock = this.storage.get(headerHash);
          if (storedBlock && storedBlock.header && storedBlock.transactions && storedBlock.transactions.length > 0) {
            debug(`new block ${blockNumber} already exists`);
            this.emit(headerHash, storedBlock);
            return resolve(storedBlock);
          } else {
            this.storage.del(headerHash);
          }
        }
        if (cyclePeers.length >= WAIT_FOR_PEERS) {
          // DEBUG
          debug(`request ${cycles} for block of hash ${headerHash}`);
          // DEBUG
          debug(`seeking block ${blockNumber} : ${headerHash}`);
          // ensure only unique headers are readded to the body list
          let found = false;
          for (let b of msgBroker.bodies) {
            if (found) continue;
            if (b.hash() === header.hash()) {
              found = true;
            }
          }
          if (!found) {
            msgBroker.bodies.push(header);
            this.broadcastMessage(ETH.MESSAGE_CODES.GET_BLOCK_BODIES, [header.hash()], 1);
          }
        }
      };
      const intervalRetry = setInterval(() => {
        if (cycles > 10) {
          clearInterval(intervalRetry);
        } else {
          _cycleGetBlock();
        }
      }, getRandomRange(ETH_INTERVAL_GET_BLOCKS_MS, ETH_INTERVAL_GET_BLOCKS_MS + 3700));
      this.once(headerHash, block => {
        // updateMem('blockReceivedEvent')
        // DEBUG
        if (!block) {
          this._logger.warn(`header hash ${headerHash} not available in cache to resolve request`);
          clearInterval(intervalRetry);
          return this.getBlock(header);
        } else {
          if (this._blockRangeLowerBound) {
            if (this._blockRangeLowerBound.height === new BN(block.header.number).toNumber()) {
              this._blockRangeLowerBound.hash = block.header.hash().toString('hex');
            }
          }
          if (this._blockRangeUpperBound) {
            if (this._blockRangeUpperBound.height === new BN(block.header.number).toNumber()) {
              this._blockRangeUpperBound.hash = block.header.hash().toString('hex');
            }
          }
          debug(`getBlock header hash once fired for hash ${headerHash}`);
          clearInterval(intervalRetry);
          return resolve(block);
        }
      });
      _cycleGetBlock();
    });
  }

  getBlocks(hashes) {
    this.broadcastMessage(ETH.MESSAGE_CODES.GET_BLOCK_BODIES, hashes);
  }

  async getBlockchain(from, to, forceHeaders) {
    if (!from) return Promise.reject(new Error('null value cannot be passed to get headers'));
    if (this._seekingBlockSegment) return Promise.resolve('cannot concurrently call sync blockchain');
    from = max(from - 1, 2);
    debug(`GET_BLOCKCHAIN: success received headers from: ${from}`);
    let headers = [];
    if (forceHeaders !== undefined) {
      this._logger.warn(`forcing ${forceHeaders.length} headers in get blockchain request`);
      headers = forceHeaders;
    } else {
      // DEBUG
      debug(`seeking ${ETH_MAX_FETCH_HEADERS} headers from block height ${from}`);
      headers = await this.getHeaders(from, to);
      if (headers) {
        debug(`${headers.length} headers given`);
      }
      if (!headers || headers.length < 1) {
        this._seekingBlockSegment = false;
        return Promise.reject(from);
      }
    }

    // clearTimeout(timeout)
    // DEBUG
    try {
      debug(`received ${headers.length} headers`);
      // for (let header of headers) {
      while (headers.length > 0) {
        try {
          const header = headers.shift();

          if (headers.length < 1) {
            this._seekingBlockSegment = false;
          }
          const blockNumber = new BN(header.number).toNumber();
          const blockTimestamp = new BN(header.timestamp).toNumber();
          // DEBUG
          debug(`seeking block ${blockNumber}`);
          let blockTimeThreshold = getBacksyncEpoch('eth');
          blockTimeThreshold = blockTimeThreshold - 51600;
          let pass = false;
          let stored = false;
          if (this._blockRangeUpperBound) {
            const h = this._blockRangeUpperBound.height;
            const l = this._blockRangeLowerBound.height;
            if (h >= blockNumber && l <= blockNumber) {
              pass = true;
            }
          }

          // double the threshold if it is requested
          if (pass) {
            blockTimeThreshold = blockTimeThreshold - 6600;
          }

          //stored = this.storage.has(header.hash().toString('hex'))
          stored = false;

          if (stored) {
            stored = this.storage.get(header.hash().toString('hex'));
            if (!stored.toJSON) {
              stored = false;
            } else if (stored.transactions && stored.transactions.length < 1) {
              // zero transactions get the block anyway
              stored = false;
            } else {
              stored = true;
            }
          }

          // DEBUG
          debug(`awaiting block ${blockNumber} from getBlock for getBlockchain`);
          this._seekingBlockSegment = true;
          const b = await this.getBlock(header);
          debug(`found block ${blockNumber} from getBlock for getBlockchain`);
        } catch (e) {
          debug(`error block ${blockNumber} from getBlock for getBlockchain`);
        }
      }
    } catch (err) {
      this._logger.error(err);
      debug(`disconnecting peer submitting inaccurate block structures and returning headers from block ${from} `);
      if (err.message !== 'block request below multiverse height threshold') {
        return Promise.reject(from);
      } else {
        return Promise.reject(err);
      }
    }
    return Promise.resolve(true);
  }

  handleMessage(rlpx, code, payload, peer) {
    if (code in msgBroker.msgTypes) {
      msgBroker.msgTypes[code] += 1;
    } else {
      msgBroker.msgTypes[code] = 1;
    }

    const peerAddr = getPeerAddr(peer);

    if (peerAddr in msgBroker.litePeer) {
      if (code !== ETH.MESSAGE_CODES.NEW_BLOCK && code !== ETH.MESSAGE_CODES.NEW_BLOCK_HASHES && code !== ETH.MESSAGE_CODES.BLOCK_HEADERS) {
        return;
      }
    }

    switch (code) {
      case ETH.MESSAGE_CODES.BLOCK_BODIES:
        this.handleMessageBlockBodies(payload, peer).catch(err => {
          this._logger.error(err);
        });
        break;

      case ETH.MESSAGE_CODES.BLOCK_HEADERS:
        this.handleMessageBlockHeaders(payload, peer).catch(err => {
          this._logger.error(err);
        });
        break;

      case ETH.MESSAGE_CODES.GET_BLOCK_BODIES:
        this.handleMessageGetBlockBodies(peer);
        break;

      case ETH.MESSAGE_CODES.GET_BLOCK_HEADERS:
        this.handleMessageGetBlockHeaders(payload, peer);
        break;

      case ETH.MESSAGE_CODES.GET_NODE_DATA:
        this.handleMessageGetNodeData(peer);
        break;

      case ETH.MESSAGE_CODES.GET_RECEIPTS:
        this.handleMessageGetReceipts(peer);
        break;

      case ETH.MESSAGE_CODES.NEW_BLOCK:
        this.handleMessageNewBlock(payload, peer).catch(err => {
          this._logger.error(err);
        });
        break;

      case ETH.MESSAGE_CODES.NEW_BLOCK_HASHES:
        this.handleMessageNewBlockHashes(payload, peer).catch(err => {
          this._logger.error(err);
        });
        break;

      case ETH.MESSAGE_CODES.TX:
        this.handleMessageTx(payload, peer);
        break;

      case ETH.MESSAGE_CODES.RECEIPTS:
        break;

      case ETH.MESSAGE_CODES.NODE_DATA:
        break;
    }
  }

  async handleMessageBlockBodies(payload, peer, recheck = false) {
    // updateMem('startHandleMessageBlockBodies')
    const peerAddr = getPeerAddr(peer);
    if (!msgBroker.performance[peerAddr]) {
      msgBroker.performance[peerAddr] = 1;
    } else {
      msgBroker.performance[peerAddr]++;
    }
    // DEBUG
    debug('handleMessageBlockBodies called');
    if (payload === undefined || payload[0] === undefined) {
      msgBroker.litePeer[peerAddr] = peer;
      if (peerAddr in msgBroker.validPeer) {
        delete msgBroker.validPeer[peerAddr];
      }
      return;
    }
    // DEBUG
    debug(`BLOCK_BODIES ${peerAddr} ${inspect(payload[0].length)}`);
    if (DAO_FORK_SUPPORT && !msgBroker.validPeer[peerAddr]) {
      this._logger.warn(` unvalidated peer ${peerAddr}`);
      return;
    }
    if (!payload) {
      msgBroker.litePeer[peerAddr] = peer;
      this._logger.warn(`${peerAddr} sent empty block body`);
      return;
    } else if (payload.length > 5) {
      this._logger.warn(`${peerAddr} not more than one block body expected (received: ${payload.length})`);
      return;
    }

    const timeout = this._forkDrops[peerAddr];
    if (timeout) {
      clearTimeout(timeout);
    }
    // DEBUG
    const unused = [];

    try {

      let pass = false;
      const found = [];
      const ipdMinHeight = new BN(this._ipdTestBlocks[0].payload.header.number).toNumber();
      while (msgBroker.bodies.length > 0 && found.length === 0) {
        const header = msgBroker.bodies.shift();
        if (!header === false) {
          const blockNumber = new BN(header.number).toNumber();
          const block = new EthereumBlock([header.raw, payload[0][0], payload[0][1]]);
          const blockHashHex = block.header.hash().toString('hex');
          const checkTrie = blockNumber + 300 < ipdMinHeight || BC_MINER_MUTEX;
          const validBlock = await validateBlock(block, checkTrie);

          if (this._blockRangeUpperBound) {
            const h = this._blockRangeUpperBound.height;
            const l = this._blockRangeLowerBound.height;
            if (h >= blockNumber && l <= blockNumber) {
              pass = true;
            }
          }

          if (this._ipdTestBlocks && this._ipdTestBlocks.length > 0 && blockNumber + 100 < new BN(this._ipdTestBlocks[0].payload.header.number).toNumber()) {
            pass = true;
          }

          if (validBlock) {
            // DEBUG
            found.push(validBlock);
            msgBroker.lastUpdate = Math.floor(new Date() / 1000);
            this.onNewBlock(validBlock, peer, pass);
            debug(`awaiting block ${blockNumber} from isValidBlock for handleBlockBodies`);
            break;
          } else {
            unused.push(header);
          }
        } else {
          unused.push(header);
          // DEBUG
          debug('headers include false value');
        }
      }

      msgBroker.bodies = msgBroker.bodies.concat(unused);

      if (this._blocksToFetch.length < 1 && msgBroker.bodies.length === 0) {
        setTimeout(() => {
          this.sync();
        }, 2000);
      }
    } catch (err) {
      debug(err);
    }

    return Promise.resolve(true);
  }

  async handleMessageBlockHeaders(payload, peer) {
    let peerAddr = false;
    if (peer && peer._socket !== undefined) {
      peerAddr = getPeerAddr(peer);
    } else {
      this._logger.warn('ignoring peer socket');
      return;
    }

    if (peerSearch) {
      peerSearch.write(peerAddr + '\n');
    }
    // DEBUG
    debug(`handleMessageBlockHeaders called with payload length: ${payload.length}`);
    // if there is exactly one block in this reply
    if (DAO_FORK_SUPPORT && !msgBroker.validPeer[peerAddr]) {
      const header = new EthereumBlock.Header(payload[0]);
      const expectedHash = DAO_FORK_SUPPORT ? CHECK_BLOCK : ETC_1920000;
      // DEBUG
      debug(`hash from peer ${header.hash().toString('hex')} expected: ${expectedHash}`);
      const timeout = this._forkDrops[peerAddr];
      // if (header.hash().toString('hex') === expectedHash || header.hash().toString('hex') === ETH_1920000) {
      if (header.hash().toString('hex') === expectedHash) {
        if (header.hash().toString('hex') === ETH_1920000) {
          this._logger.warn(`peer sent default check block instead of ${ETH_1920000}`);
        } // DEBUG this._logger.info(`${peerAddr} verified to be on the same side of the DAO fork`)
        msgBroker.validPeer[peerAddr] = peer;

        this._dpt.bootstrap(getBootnodeObject(peer)).catch(err => {
          debug(`DPT bootstrap error: ${err.stack || err.toString()}`);
        });
      } else {
        // DEBUG
        debug(`disconnecting external chain edge ${peerAddr} -> x`);
        // msgBroker.litePeer[peerAddr] = peer
        this._dpt.bootstrap(getBootnodeObject(peer)).then(() => {}).catch(err => {
          debug(`DPT bootstrap error: ${err.stack || err.toString()}`);
          peer && peer.disconnect && peer.disconnect(RLPx.DISCONNECT_REASONS.USELESS_PEER);
        });
      }
      if (timeout) {
        clearTimeout(timeout);
        this._dpt.bootstrap(getBootnodeObject(peer)).catch(err => {
          debug(`DPT bootstrap error: ${err.stack || err.toString()}`);
          peer && peer.disconnect && peer.disconnect(RLPx.DISCONNECT_REASONS.USELESS_PEER);
        });
      }

      // if the peer fork has been confirmed and there is more to the payload request the block bodies
    } else if (payload.length > 0 && msgBroker.validPeer[peerAddr]) {
      const pendingRequest = [];
      const directRequest = [];
      const receivedHeaders = payload.map(header => new EthereumBlock.Header(header));
      // DEBUG
      debug(`received headers length: ${receivedHeaders.length}`);
      //const headers = receivedHeaders.splice(0, ETH_MAX_FETCH_HEADERS)
      const headers = receivedHeaders;
      // DEBUG
      debug(`segmented headers length: ${headers.length}`);
      let lowestNumber = false;
      while (headers.length > 0) {
        const header = headers.shift();
        const blockHash = header.hash().toString('hex');
        const blockNumber = new BN(header.number).toNumber();
        if (!lowestNumber) {
          lowestNumber = blockNumber;
        } else if (lowestNumber > blockNumber) {
          lowestNumber = blockNumber;
        }
        if (msgBroker.directRequests.indexOf(blockHash) < 0) {
          pendingRequest.push(header);
          continue;
        }
        directRequest.push(header);
        msgBroker.directRequests.splice(msgBroker.directRequests.indexOf(blockHash), 1);
      }
      // DEBUG
      debug(`headers to evaluate: ${headers.length}`);
      debug(`pending headers to request: ${pendingRequest.length}`);
      debug(`direct headers to request: ${directRequest.length}`);
      if (directRequest.length > 0) {
        while (headers.length > 0) {
          const header = headers.shift();
          let pass = false;
          const headerHash = header.hash().toString('hex');
          const blockNumber = new BN(header.number).toNumber();
          if (!lowestNumber && payload.length > 1) {
            debug(`setting lowest number to ${blockNumber}`);
            lowestNumber = blockNumber;
          } else if (lowestNumber > blockNumber && payload.length > 1) {
            debug(`setting lowest number to ${blockNumber}`);
            lowestNumber = blockNumber;
          }
          let blockTimeThreshold = getBacksyncEpoch('eth');
          blockTimeThreshold = blockTimeThreshold - 21600;
          if (this._blockRangeUpperBound) {
            const h = this._blockRangeUpperBound.height;
            const l = this._blockRangeLowerBound.height;
            if (h >= blockNumber && l <= blockNumber) {
              pass = true;
            }
          }
          // double the threshold if it is requested
          if (pass) {
            blockTimeThreshold = blockTimeThreshold - 6600;
          }
          if (this._fetchCache.has(blockNumber)) {
            debug(`block ${blockNumber} directly requested <- permitting through to getBlock()`);
          }
          const blockTimestamp = new BN(header.timestamp).toNumber();
          await this.getBlock(header);
        }
      }

      if (lowestNumber) {
        debug(`emitting ${pendingRequest.length} headers from lowest number ${lowestNumber}`);
        this.emit(`headers:${lowestNumber}`, pendingRequest);
      }
    } else {
      debug('ignoring block header from lite peer');
      msgBroker.litePeer[peerAddr] = peer;
      if (peerAddr in msgBroker.validPeer) {
        delete msgBroker.validPeer[peerAddr];
      }
    }

    this.sync();
  }

  handleMessageGetBlockBodies(peer) {
    // ETH.MESSAGE_CODES.GET_BLOCK_BODIES
    const peerAddr = getPeerAddr(peer);
    if (msgBroker.headers.length === 0 && msgBroker.msgTypes[ETH.MESSAGE_CODES.GET_BLOCK_BODIES] > 16) {
      msgBroker.litePeer[peerAddr] = peer;
      if (peerAddr in msgBroker.validPeer) {
        delete msgBroker.validPeer[peerAddr];
      }
    }
    const eth = peer.getProtocols()[0];
    eth.sendMessage(ETH.MESSAGE_CODES.BLOCK_BODIES, []);
  }

  handleMessageGetBlockHeaders(payload, peer) {
    const headers = [];
    // hack
    if (DAO_FORK_SUPPORT && _util.buffer2int(payload[0]) === CHECK_BLOCK_NR) {
      headers.push(CHECK_BLOCK_HEADER);
    }
    const eth = peer.getProtocols()[0];
    eth.sendMessage(ETH.MESSAGE_CODES.BLOCK_HEADERS, headers);
    this.sync();
  }

  handleMessageGetNodeData(peer) {
    const eth = peer.getProtocols()[0];
    eth.sendMessage(ETH.MESSAGE_CODES.NODE_DATA, []);
  }

  handleMessageGetReceipts(peer) {
    const eth = peer.getProtocols()[0];
    eth.sendMessage(ETH.MESSAGE_CODES.RECEIPTS, []);
  }

  async handleMessageNewBlock(payload, peer, forceBlock) {
    const peerAddr = getPeerAddr(peer);
    // DEBUG
    debug(`handleMessageNewBlock called from peer ${peerAddr}`);
    if (DAO_FORK_SUPPORT && !msgBroker.validPeer[getPeerAddr(peer)]) {
      return;
    }

    const timeout = this._forkDrops[peerAddr];
    if (timeout) {
      clearTimeout(timeout);
    }

    if (this._ipdTestBlocks.length < ETH_IPD_TEST_BLOCKS && !forceBlock) {

      msgBroker.lastUpdate = Math.floor(new Date() / 1000);

      const state = {
        payload: new EthereumBlock(payload[0]),
        peer: peer,
        sent: 1
      };
      const testPeers = this._ipdTestBlocks.reduce((all, data) => {
        all.push(getPeerAddr(data.peer));
        return all;
      }, []);

      // all peers must be unique
      if (testPeers.indexOf(peerAddr) < 0) {
        this._ipdTestBlocks.push(state);
        this._logger.info(`new block IPD evaluation ${peerAddr} (${this._ipdTestBlocks.length}/${ETH_IPD_TEST_BLOCKS})...`);
      } else {
        this._ipdTestBlocks[testPeers.indexOf(peerAddr)].sent++;
      }
      if (this._ipdTestBlocks.length < ETH_IPD_TEST_BLOCKS) {
        return;
      }
      this._logger.info('IPD evaluations...complete -> beginning far reaching block search');
    }

    if (this._ipdTestBlocks.length >= ETH_IPD_TEST_BLOCKS && !this._ipdTestComplete && !forceBlock) {
      // run the IPD test
      const block = new EthereumBlock(payload[0]);
      const hash = block.header.hash().toString('hex');
      const blockHeight = block.header.number;

      if (this.storage.has(hash) && !this._fetchCache.has(blockHeight)) {
        this._logger.info(`rover evaluations...complete for ${blockHeight}  -> continuing search`);
        return Promise.resolve(true);
      }
      const avg = this._ipdTestBlocks.reduce((all, b) => {
        all = new BN(all).add(new BN(b.payload.header.number)).toNumber();
        return all;
      }, 0) / this._ipdTestBlocks.length;
      // The IPD test for highest puts the blocks received against eachother to stabilize the segment of Ethereum used for the initial sync
      // this part is made irrelvant once the Block Collider chain has started as the segment can be weighed against the difficulty of
      // Block Collider blocks to select the strongest blocks
      const highest = this._ipdTestBlocks.reduce((all, sample) => {
        if (!all) {
          return sample;
        }
        const testBlock = sample.payload;
        const currentBlock = all.payload;
        const testBlockNumber = new BN(testBlock.header.number).toNumber();
        const currentBlockNumber = new BN(currentBlock.header.number).toNumber();
        debug(`evaluating IPD block ${testBlockNumber} against ${currentBlockNumber}`);
        const testDiff = getIntervalDifficulty(testBlock);
        const currentDiff = getIntervalDifficulty(currentBlock);
        const blockIsHigher = new BN(testBlockNumber).gt(new BN(currentBlockNumber));
        const blockIsMoreDifficult = new BN(testDiff).gt(new BN(currentDiff));
        if (blockIsHigher) {
          all = sample;
          return all;
        } else if (blockIsHigher && !blockIsMoreDifficult) {
          const testDiffMean = Math.abs(testBlockNumber - avg);
          const currentDiffMean = Math.abs(currentBlockNumber - avg);
          if (testDiffMean < currentDiffMean) {
            all = sample;
            return all;
          }
        } else if (blockIsHigher && blockIsMoreDifficult) {
          all = sample;
          return all;
        }
        return all;
      }, false);
      this._ipdTestComplete = !!highest;
      const match = this._ipdTestBlocks.reduce((all, b) => {
        if (b.payload.header.hash().toString('hex') === highest.payload.header.hash().toString('hex')) {
          return b;
        }
        return all;
      }, false);

      if (match) {
        this._bestSeenBlock = match.payload;
        this._lowestBlockHeight = new BN(match.payload.header.number).sub(new BN(requiredBlocks)).toNumber();
        await this.handleMessageNewBlock(match.payload, match.peer);
      }
      if (new BN(match.payload.header.number).lt(new BN(block.header.number))) {
        this._logger.info('block number is lower than highest');
        return Promise.resolve(false);
      }
    } else if (this._ipdTestComplete) {
      try {
        let lowestBlockHeight = this._lowestBlockHeight;
        if (this._bestSeenBlock) {
          lowestBlockHeight = new BN(this._bestSeenBlock.header.number).sub(new BN(requiredBlocks)).toNumber();
        }
        let newBlock = forceBlock;
        if (!newBlock) {
          newBlock = new EthereumBlock(payload[0]);
        }

        let pass = false;
        let blockTimeThreshold = getBacksyncEpoch('eth');
        blockTimeThreshold = blockTimeThreshold - 91600;
        const headerHash = newBlock.header.hash().toString('hex');
        const blockTimestamp = new BN(newBlock.header.timestamp).toNumber();
        const blockNumber = new BN(newBlock.header.number).toNumber();
        if (blockNumber < lowestBlockHeight) {
          debug(`block ${blockNumber} below lowest block boundary ${lowestBlockHeight}`);
          return Promise.resolve(false);
        }

        if (this._bestSeenBlock) {
          const bestBlockNumber = parseInt(pathOr(Buffer.from('00', 'hex'), ['header', 'number'], this._bestSeenBlock).toString('hex'), 16);
          if (blockNumber > bestBlockNumber + 500) {
            this._logger.warn(`block number ${blockNumber} is beyond maximum best block range from ${bestBlockNumber} <- disconnect peer`);
            peer && peer.disconnect && peer.disconnect();
            return;
          }
        }

        debug(`received block #${blockNumber} - ${blockTimestamp} ${headerHash}`);
        // if block is below the backsync epoch resolve the transaction
        if (this._blockRangeUpperBound) {
          const h = this._blockRangeUpperBound.height;
          const l = this._blockRangeLowerBound.height;
          if (h >= blockNumber && l <= blockNumber) {
            pass = true;
          }
        }

        // double the threshold if it requested
        if (pass) {
          blockTimeThreshold = blockTimeThreshold - 6600;
        }

        if (new BN(blockTimestamp).lt(new BN(blockTimeThreshold)) && this._blocksToFetch.length === 0) {
          if (!pass) {
            this._logger.warn(`block ${blockNumber} time ${blockTimestamp} is below the backsync threshold ${blockTimeThreshold}`);
            // peer && peer.disconnect && peer.disconnect()
            return Promise.resolve(false);
          }
        }

        const checkTrie = blockNumber + 300 < ipdMinHeight || BC_MINER_MUTEX;
        const validBlock = await validateBlock(newBlock, checkTrie);

        if (validBlock) {
          msgBroker.lastUpdate = Math.floor(new Date() / 1000);
          debug(`valid block from eth peer ${blockNumber}`);
          this.onNewBlock(newBlock, peer, pass);
        } else {
          debug(`block from eth peer ${blockNumber} failed generate trie`);
          return;
        }
      } catch (err) {
        debug(err);
      }
    }
    // if there are functions already waiting for this block
    return Promise.resolve(true);
  }

  async handleMessageNewBlockHashes(payload, peer) {
    const peerAddr = getPeerAddr(peer);
    // DEBUG
    debug(`handleMessageNewBlockHashes called with payload: ${payload.length}`);
    const eth = peer.getProtocols()[0];
    const hashes = payload;
    const item = hashes[0];
    for (const item of hashes) {
      const blockHash = item[0].toString('hex');
      if (msgBroker.directRequests.indexOf(blockHash) < 0) {
        msgBroker.directRequests.push(blockHash);
      }

      setTimeout(() => {
        eth.sendMessage(ETH.MESSAGE_CODES.GET_BLOCK_HEADERS, [blockHash, ETH_MAX_FETCH_HEADERS, 0, 0]);
      }, 200);
    }
  }

  handleMessageTx(payload, peer) {
    if (DAO_FORK_SUPPORT && !msgBroker.validPeer[getPeerAddr(peer)]) {
      return;
    }

    for (const item of payload) {
      const tx = new EthereumTx(item);
      if (isValidTx(tx)) {
        this.onNewTx(tx, peer);
      }
    }
  }

  handlePeerAdded(rlpx, peer) {
    const peerAddr = getPeerAddr(peer);
    const eth = peer.getProtocols()[0];
    const clientId = peer.getHelloMessage().clientId;
    const currentCount = Object.keys(msgBroker.registry).length;
    if (!msgBroker.registry[peerAddr]) {
      msgBroker.registry[peerAddr] = 1;
      if (currentCount % 100 === 0) {
        this._logger.info(`rover candidate graph expansion <- ${currentCount} edges`);
      }
    } else {
      debug(`previously traversed edge ${peerAddr} -> reevaluating`);
      // peer && peer.disconnect && peer.disconnect(RLPx.DISCONNECT_REASONS.USELESS_PEER)
      // this._dpt.removePeer(peer)
      // return
    }
    // debug(`peer connected with peer hello: ${clientId}`)
    // send status, see:
    const bestHash = Buffer.from('d4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3', 'hex');
    const td = _util.int2buffer(17179869184);

    if (true || BC_NETWORK === 'main') {
      // eslint-disable-line

      const peers = [].concat(Object.values(msgBroker.validPeer)).filter(peer => {
        if (!msgBroker.litePeer[getPeerAddr(peer)]) {
          return peer;
        }
      });

      eth.sendStatus({
        networkId: CHAIN_ID,
        td: td, // total difficulty in genesis block
        bestHash: bestHash,
        genesisHash: Buffer.from('d4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3', 'hex')
      });
    } else {
      // test network, eth rover watches ropsten
      this._logger.warn('sending message in context of peer status');
      eth.sendStatus({
        networkId: 3,
        td: _util.int2buffer(1048576), // total difficulty in genesis block
        bestHash: Buffer.from('41941023680923e0fe4d74a34bdac8141f2540e3ae90623718e47d66d1ca4a2d', 'hex'),
        genesisHash: Buffer.from('41941023680923e0fe4d74a34bdac8141f2540e3ae90623718e47d66d1ca4a2d', 'hex')
      });
    }

    // check DAO if on mainnet
    eth.once('status', () => {
      debug(`peer ${peerAddr} status received`);

      this._forkDrops[peerAddr] = setTimeout(() => {
        debug(`fork drop timeout fired -> disconnecting peer ${peerAddr}`);
        peer && peer.disconnect && peer.disconnect(RLPx.DISCONNECT_REASONS.USELESS_PEER);
        this._dpt.removePeer(peer);
      }, 35000 /* 25 sec */);

      peer.once('close', () => {
        const timeout = this._forkDrops[peerAddr];
        if (timeout) {
          clearTimeout(timeout);
        }

        if (peerAddr in msgBroker.validPeer) {
          delete msgBroker.validPeer[peerAddr];
        }
        if (peerAddr in msgBroker.litePeer) {
          delete msgBroker.litePeer[peerAddr];
        }
      });

      eth.sendMessage(ETH.MESSAGE_CODES.GET_BLOCK_HEADERS, [CHECK_BLOCK_NR, 1, 0, 0]);
    });

    eth.on('message', async (code, payload) => {
      this.handleMessage(rlpx, code, payload, peer);
    });
  }

  handlePeerError(dpt, peer, err) {
    // $FlowFixMe
    if (err.code === 'ECONNRESET') {
      return;
    }

    if (err instanceof assert.AssertionError) {
      const peerId = peer.getId();

      if (peerId !== null) {
        dpt.banPeer(peerId, 300000 /* 5 minutes */);
      }

      // debug(`peer error (${getPeerAddr(peer)}): ${err.message}`)
    }
  }

  handlePeerRemoved(rlpx, peer, reason, disconnectWe) {
    delete msgBroker.validPeer[getPeerAddr(peer)];
    delete msgBroker.litePeer[getPeerAddr(peer)];
  }

  onError(msg, err) {}
  // this._logger.error(`Error: ${msg} ${err.toString()}`)


  // TODO port is never used
  run(port) {
    // DPT
    this._dpt = new DPT(this._key, {
      refreshInterval: 49000,
      //timeout: 13100,
      maxPeers: 30000,
      endpoint: {
        address: '0.0.0.0',
        udpPort: null,
        tcpPort: null
      }
    });

    this._dpt.on('error', err => this.onError('DPT Error', err));

    this.on('compressBlock', block => {
      try {
        if (block && block.header && block.header.hash) {
          ARCHIVE_COUNTER++;
          const hash = block.header.hash().toString('hex');
          const num = new BN(block.header.number).toNumber();
          // nudge GC
          let archive = true;
          if (this._bestSeenBlock) {
            // save the last 100 blocks pre archive
            if (hash === this._bestSeenBlock.header.hash().toString('hex') || num > new BN(this._bestSeenBlock.header.number).toNumber() - 200) {
              archive = false;
            }
          }
          if (archive) {
            this._logger.info(`block ${num} compressed ${hash}`);
            this.storage.archive(hash);
            for (const k of Object.keys(block)) {
              delete block[k];
            }
          } else {
            debug(`block newness ${num} lite compress ${hash}`);
            this.storage.set(hash, block);
          }

          if (ARCHIVE_COUNTER % 30000 === 0) {
            this.storage.processExpirations();
          }
          // DEBUG
        } else {
          debug('compress event fired where block object was already removed');
        }
      } catch (err) {
        this._logger.error(err);
      }
    });

    const rlpx = this._rlpx = new RLPx(this._key, {
      dpt: this._dpt,
      // maxPeers: this._maximumPeers,
      maxPeers: 30000,
      capabilities: [ETH.eth63, ETH.eth62],
      remoteClientIdFilter: REMOTE_CLIENTID_FILTER,
      listenPort: null
    });

    rlpx.on('error', err => this.onError('RLPX Error', err));

    rlpx.on('peer:added', peer => this.handlePeerAdded(rlpx, peer));

    rlpx.on('peer:removed', (peer, reason, disconnectWe) => this.handlePeerRemoved(rlpx, peer, reason, disconnectWe));

    rlpx.on('peer:error', (peer, err) => this.handlePeerError(this._dpt, peer, err));

    rlpx.listen(30303, '0.0.0.0');
    this._dpt.bind(30303, '0.0.0.0');

    BOOTNODES.slice(0, 155).map(bootnode => {
      // $FlowFixMe
      this._dpt.bootstrap(bootnode).catch(err => {
        // debug(`DPT bootstrap error: ${err.stack || err.toString()}`)
      });
    });

    setInterval(() => {
      this._dpt.bootstrap(BOOTNODES.pop()).catch(err => {
        // debug(`DPT bootstrap error: ${err.stack || err.toString()}`)
      });
    }, 1500);
  }

  close() {
    this._syncCheckTimeout && clearInterval(this._syncCheckTimeout);
  }
}
exports.default = Network;