'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.addressToHost = undefined;

var _decimal = require('decimal.js');

_decimal.Decimal.set({ toExpPos: 100 }); /*
                                          * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
                                          *
                                          * This source code is licensed under the MIT license found in the
                                          * LICENSE file in the root directory of this source tree.
                                          *
                                          * 
                                          */

_decimal.Decimal.set({ toExpNeg: -100 });
const { join } = require('path');
const { inspect, format: utilFormat } = require('util');
const RocksDb = require('rocksdb');
const BN = require('bn.js');
const debug = require('debug')('bcnode:persistence:rocksdb');
const debugPrevUncles = require('debug')('bcnode:persistence:prevuncles');
const debugHeight = require('debug')('bcnode:persistence:height');
const debugMarked = require('debug')('bcnode:persistence:marked');
const debugUTXO = require('debug')('bcnode:persistence:utxos');
const debugEMBBalance = require('debug')('bcnode:persistence:emb');
const debugSettle = require('debug')('bcnode:persistence:settle');
const debugUTXODetail = require('debug')('bcnode:persistence:utxosDetail');
const debugWriteOperations = require('debug')('bcnode:persistence:writeoperations');
const debugReadOperations = require('debug')('bcnode:persistence:readoperations');
const debugReorg = require('debug')('bcnode:persistence:reorg');
const debugOrg = require('debug')('bcnode:persistence:org');
const debugSpending = require('debug')('bcnode:persistence:spending');
const debugPutBlock = require('debug')('bcnode:persistence:putblock');
const debugPutTransaction = require('debug')('bcnode:persistence:puttx');
const debugLatest = require('debug')('bcnode:persistence:latest');
const { EventEmitter } = require('events');

const debugShift = require('debug')('bcnode:persistence:rovershift');
const LRUCache = require('lru-cache');
const mkdirp = require('mkdirp');
const { calcTxFee } = require('bcjs/dist/transaction');
const { blake2bl } = require('../utils/crypto');
const { shortenHash } = require('../utils/strings');
const { COINBASE_TX_ESTIMATE_SIZE, getMaxBlockSize, getMaxDistanceWithEmblems, getNrgGrant, getTxsDistanceSum } = require('../core/txUtils');
const { concat } = require('ramda');

const { networks, wasabiBulletProofs } = require('../config/networks');
const { toASM, fromASM } = require('bcjs/dist/script/bytecode');
const {
  BC_COINBASE_MATURITY,
  getMarkedTransactionsMerkle,
  parseNRGLockcript,
  parseTakerUnlockScript,
  parseMakerLockScript,
  parseTakerLockScript
} = require('../core/txUtils');

const { internalToHuman, internalToBN, humanToBN, COIN_FRACS: { NRG, BOSON } } = require('../core/coin');
const { contains, equals, flatten, is, isEmpty, last, min, max, toPairs, zip, zipObj } = require('ramda');
const {
  BcBlock,
  Block,
  BlockchainHeaders,
  BlockchainHeader,
  Transaction,
  MarkedTransaction,
  TransactionInput,
  Utxo,
  TransactionOutput
} = require('../protos/core_pb');
const numCPUs = Number(require('os').cpus().length);
const loadBasedPeerExpiration = 90000 + Math.floor(80000 / numCPUs);
const BC_PEER_HEADER_SYNC_EXPIRE = Number(process.env.BC_PEER_HEADER_SYNC_EXPIRE) || loadBasedPeerExpiration; // Peer must return a header request before time elapsed (milliseconds)
const { InitialPeer } = require('../protos/p2p_pb');
const { serialize, deserialize } = require('./codec');
const { getLogger } = require('../logger');
const { blockchainMapToList } = require('../mining/primitives');
const { parseBoolean } = require('../utils/config');
const { isValidBlock } = require('../bc/validation');
const UnsettledTxManagerAlt = require('../bc/unsettledTxManagerAlt');

const OL_FAST_SYNC = process.env.OL_FAST_SYNC ? parseBoolean(process.env.OL_FAST_SYNC) : false;
const CHECK_SPENT_HASH = process.env.CHECK_SPENT_HASH;
const CHECK_SPENT_INDEX = process.env.CHECK_SPENT_INDEX;
const BC_SUPER_COLLIDER = process.env.BC_SUPER_COLLIDER ? process.env.BC_SUPER_COLLIDER.toLowerCase() : 'bc';
const BC_MARKED_DRY_RUN = process.env.BC_MARKED_DRY_RUN === 'true';
const { getChildBlocks } = require('../bc/tokenDictionary');
const { sortBlocks } = require('../utils/protoBuffers');
const { getScriptType, ScriptType } = require('bcjs/dist/script/templates');
const { ROVER_RESYNC_PERIOD, ROVER_SECONDS_PER_BLOCK, ROVER_CONFIRMATIONS } = require('../rover/utils');
const { BTC_SYNCHRONIZATION_STOP } = require('../rover/btc/controller');
const SUPPORTED_SCHEDULED_OPERATIONS = ['get', 'put', 'del', 'delfromlist', 'extendmultiverse'];

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

const sortBlockList = blockList => {
  return blockList.sort((a, b) => {

    if (new BN(a.getTotalDistance()).gt(new BN(b.getTotalDistance()))) {
      return -1;
    }

    if (new BN(b.getTotalDistance()).gt(new BN(a.getTotalDistance()))) {
      return 1;
    }

    return 0;
  });
};

const hasAddressInScript = (script, address) => {
  address = address.toLowerCase();
  script = toASM(Buffer.from(script), 0x01);
  const asBlakePowered = blake2bl(blake2bl(address) + address);
  return script.indexOf(asBlakePowered) > -1;
};

const BC_NETWORK = process.env.BC_NETWORK || 'main';
const EMBLEM_CONTRACT_ADDRESS = networks[BC_NETWORK].rovers.eth.embContractId;
const isNotFoundError = errStr => /Error: NotFound: /.test(errStr);
const NRG_MINTED_PERISTENCE_KEY = `${BC_SUPER_COLLIDER}.nrg.granted`;

/**
 * Unified persistence interface
 */

class PersistenceRocksDb {

  constructor(location = '_data', engine, multichainState) {

    const dataDir = join(location, 'db');
    mkdirp.sync(dataDir);
    this._writeEventTable = {};
    this._readEventTable = {};
    this._logger = getLogger(__dirname);
    this._db = new RocksDb(dataDir);
    this._isOpen = false;
    this._blockByHeightCache = new LRUCache({
      max: 1000
    });
    this._blockHashAtHeightCache = new LRUCache({
      max: 20000
    });
    this._blocksByHeightCache = new LRUCache({
      max: 1000
    });

    this._inlineBlockCache = new LRUCache({
      max: 50
    });

    this._blockSavedCache = new LRUCache({
      max: 5000
    });

    this._blockByHashCache = new LRUCache({
      max: 10000
    });

    this._blockByTxCache = new LRUCache({
      max: 100
    });

    this._transactionByHashCache = new LRUCache({
      max: 100000
    });

    this._utxoLengthCache = new LRUCache({
      max: 10
    });

    this._blockByUtxoCache = new LRUCache({
      max: 1000
    });

    this._currBlockEvalCache = new LRUCache({
      max: 1
    });

    this._cache = new LRUCache({
      max: 1000
    });
    this._completedBlockSegmentsCache = new LRUCache({
      max: 250
    });

    this._engine = engine;

    this._unsettledTxManager = new UnsettledTxManagerAlt(this, engine.minerKey);

    this._engine._ = new EventEmitter();

    this._engine._.on(`e`, async () => {
      this._logger.info(`event emitter`);
      const i = await this.get('_');
      if (i) {
        const n = parseInt(i, 10);
        await this.put(`_`, `${n + 1}`);
      } else {
        await this.put(`_`, `${1}`);
      }
    });

    //setInterval(() => {
    //  console.log('-------- READ/WRITE OPERATIONS --------')
    //  console.log(this._writeEventTable)
    //  console.log(this._readEventTable)
    //}, 30000)
  }

  // eslint-disable-line no-undef

  get db() {
    return this._db;
  }

  // eslint-disable-line no-undef

  get isOpen() {
    return this._isOpen;
  }

  get cache() {
    return this._cache;
  }

  async saveTxsForBlock(block) {
    try {
      // store txs
      if (!block || block && !block.getTxsList) return false;
      const txs = block.getTxsList();
      for (let i = 0; i < txs.length; i++) {
        let tx = txs[i];
        if (CHECK_SPENT_HASH && CHECK_SPENT_INDEX) {
          for (let j = 0; j < tx.getInputsList().length; j++) {
            let o = tx.getInputsList()[j].getOutPoint();
            if (o.getHash() === CHECK_SPENT_HASH && o.getIndex() === parseInt(CHECK_SPENT_INDEX)) {
              console.log("found block in " + block.getHeight() + ' , ' + block.getHash());
            }
          }
        }
        if (tx.getHash() === CHECK_SPENT_HASH) {
          console.log('tx created in ' + tx.getHash());
        }
        await this.putTransaction(tx, block.getHash(), 0, 'bc');
        await this.putTransactionBlockIndex([tx.getHash()], block.getHash(), block.getHeight(), 0, 'bc');
      }
    } catch (err) {
      this._logger.info(err);
    }
    return true;
  }

  async delUtxoUnmount() {
    const u = await this.get(`${BC_SUPER_COLLIDER}.unmount`);
    if (u) {
      debug(`removing unmount ${u}`);
      await this.del(`${BC_SUPER_COLLIDER}.unmount`);
    }
    return true;
  }

  async delUtxoRemount() {
    const u = await this.get(`${BC_SUPER_COLLIDER}.remount`);
    if (u) {
      this._logger.info(`removing remount ${u}`);
      await this.del(`${BC_SUPER_COLLIDER}.remount`);
    }
    return true;
  }

  async getUtxoRemount() {
    try {
      const remount = await this.get(`${BC_SUPER_COLLIDER}.remount`);
      if (remount && remount.length > 0) {
        return parseInt(remount.split(':')[0], 10);
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  async getUtxoUnmount() {
    try {
      const unmount = await this.get(`${BC_SUPER_COLLIDER}.unmount`);
      if (unmount && unmount.length > 0) {
        return parseInt(unmount.split(':')[0], 10);
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  async saveLast100(block) {
    debugUTXO(`saving last 100 from ${block.getHeight()}`);
    let height = block.getHeight();
    while (block && height - block.getHeight() < 100) {
      await this.saveTxsForBlock(block);
      block = await this.getBlockByHash(block.getPreviousHash(), 'bc');
    }
  }

  async saveTxs() {
    let block = await this.get('bc.block.last.utxoSaved');
    while (block) {
      if (block.getHeight() % 10000 === 0) console.log(`checking ${block.getHeight()}`);

      await this.saveTxsForBlock(block);

      let prev = block.getPreviousHash();
      let height = block.getHeight();
      block = await this.getBlockByHash(prev, 'bc');
      // console.log({prev,height,block})
      if (!block) {
        console.log(`getting height ${height - 1}`);
        block = await this.getBlockByHeight(height - 1, 'bc');
        let blocks = await this.getBlocksByHeight(height - 1, 'bc');
        if (blocks) blocks = blocks.filter(b => {
          return b.getHash() === prev;
        });
        if (blocks.length === 1) {
          block = blocks[0];
        }
        if (block) await this.put(`bc.block.${block.getHash()}`, block);
      }
    }
  }

  /**
   * Open database
   * @param opts
   */
  open(opts = {}) {
    return new Promise((resolve, reject) => {
      this.db.open(opts, err => {
        if (err) {
          this._isOpen = false;
          return reject(err);
        }

        this._isOpen = true;
        return resolve(true);
      });
    });
  }

  /**
   * Close database
   */
  close() {
    return new Promise((resolve, reject) => {
      this.db.close(err => {
        if (err) {
          return reject(err);
        }

        resolve(true);
      });
    });
  }

  /**
   * Put data into database
   * @param key
   * @param value
   * @param opts
   */
  put(key, value, opts = {}) {
    debug('put()', key);

    let serialized;
    try {
      serialized = serialize(value);
    } catch (e) {
      debug('put()', e);
      this._logger.warn(`put() ${e}`);
      const msg = utilFormat('Could not serialize key: %s, value: %O', key, value.toObject ? value.toObject() : value);
      this._logger.warn(msg);
      throw e;
    }
    return new Promise((resolve, reject) => {
      this.db.put(key, serialized, opts, err => {
        if (err) {
          return reject(err);
        }

        return resolve(true);
      });
    });
  }

  /**
   * Get data from database
   * @param key
   * @param opts
   */
  get(key, opts = { asBuffer: true }) {
    debug('get()', key);

    if (Array.isArray(key)) {
      const msg = 'PersistenceRocksDb.get() for bulk gets is deprecated, use PersistenceRocksDb.getBulk() instead';
      this._logger.error(msg);
      return Promise.reject(new Error(msg));
    }

    return new Promise((resolve, reject) => {
      this.db.get(key, opts, (err, value) => {
        // we got error from Rocksdb underlying library
        if (err) {
          // it is 'not found error' -> resolve as null
          if (isNotFoundError(err.toString())) {
            this._logger.debug(`key: ${key} not found`);
            return resolve(null);
          }

          // TODO: inspect if could happen
          if (opts && opts.softFail) {
            return resolve(value);
          }

          // if other error occured, reject with it
          return reject(new Error(`${err.toString()} while getting key: ${key}`));
        }

        try {
          // deserialization went ok -> resolve with deserialized value
          const deserialized = deserialize(value);
          return resolve(deserialized);
        } catch (e) {
          // deserialization failed and softFail requested -> resolve with null
          if (opts && opts.softFail === false) {
            return resolve(null);
          }
          this._logger.warn(`Could not deserialize value ${e}`);
          // deserialization failed and no softFail -> reject with error
          return reject(new Error('Could not deserialize value'));
        }
      });
    });
  }

  getBulk(key, opts = { asBuffer: true, utxoCache: false }) {
    const promises = key.map(k => {
      return this.get(k);
    });

    return Promise.all(promises.map(p => p.catch(e => null))).then(results => {
      return Promise.all(results.filter(a => a !== null));
    });
  }

  putBulk(key, opts = { asBuffer: true }) {
    try {
      const op = key.map(k => {
        return { type: 'put', key: k[0], value: serialize(k[1]) };
      });
      return new Promise((resolve, reject) => {
        this.db.batch(op, {}, err => {
          if (err) {
            return reject(err);
          }
          return resolve(true);
        });
      });
    } catch (err) {
      this._logger.info(err);
      throw err;
    }
  }

  /**
   * Delete data from database
   * @param key
   * @param opts
   */
  del(key, opts = {}) {
    debug('del()', key);

    return new Promise((resolve, reject) => {
      this.db.del(key, opts, err => {
        if (err) {
          return reject(err);
        }
        resolve(true);
      });
    });
  }

  delBulk(keys, opts = {}) {
    try {
      const op = keys.map(k => {
        return { type: 'del', key: k };
      });
      return new Promise((resolve, reject) => {
        this.db.batch(op, {}, err => {
          if (err) {
            return reject(err);
          }
          return resolve(true);
        });
      });
    } catch (err) {
      this._logger.info(err);
      throw err;
    }
  }

  async stepFrom(blockchain, start, opts = {
    highWaterMark: 100000000,
    asBuffer: true
  }) {
    return new Promise((resolve, reject) => {
      const cycle = async n => {
        try {
          await this.get(blockchain + '.' + n);
          return cycle(n + 1);
        } catch (err) {
          this._logger.debug(err);
          return resolve(n - 1);
        }
      };
      return cycle(start);
    });
  }

  /**
   * Removes blocks stored in persistence that match a given blockchain
   * @param blockchain string
   * @param start Number
   * @param start Number
   * @param opts
   */
  flushFrom(blockchain, start = 2, until = 0, opts = {
    highWaterMark: 100000000,
    asBuffer: true
  }) {
    let count = 0;
    return new Promise((resolve, reject) => {
      const iter = this.db.iterator(opts);
      const cycle = () => {
        return iter.next((err, key) => {
          if (key !== undefined) {
            count++;
          }
          this._logger.info('---------------------' + key);
          if (err) {
            return reject(err);
          } else if (key !== undefined && key.indexOf(blockchain) > -1) {
            // default is to flush continuously unless until is defined
            let pass = true;
            if (until > 0) {
              if (key.indexOf('.') > -1 && key.split('.').pop() < until) {
                pass = true;
              } else {
                pass = false;
              }
            }
            if (pass) {
              if (Number(key.split('.').pop()) > start) {
                return this.del(key).then(cycle).catch(e => {
                  return reject(err);
                });
              }
            }
            return cycle();
          } else if (key !== undefined) {
            return cycle();
          } else {
            this._logger.info('flushed ' + count + ' of ' + blockchain);
            return resolve(true);
          }
        });
      };
      return cycle();
    });
  }

  /**
   * Write pending values to perminent values
   * @param blockchain string
   * @param opts
   */
  putPending(blockchain = 'bc', opts = { highWaterMark: 100000000, asBuffer: true }) {
    return new Promise((resolve, reject) => {
      const iter = this.db.iterator(opts);
      const cycle = () => {
        return iter.next((err, key) => {
          if (err) {
            return reject(err);
          } else if (key !== undefined && key.indexOf('pending.' + blockchain) > -1) {
            return this.get(key).then(res => {
              const stringKey = key.replace('pending.', '');
              this._logger.info(stringKey);
              return this.put(stringKey, res).then(cycle).catch(err => {
                return reject(err);
              });
            }).catch(err => {
              return reject(err);
            });
          }
        });
      };
      return cycle();
    });
  }

  async getBlockBoundariesToFetch(headers) {
    let headerList;
    try {
      headerList = blockchainMapToList(headers);
    } catch (_) {
      return false;
    }
    const boundaries = {
      btc: [],
      eth: [],
      lsk: [],
      neo: [],
      wav: []
    };

    const TOO_OLD_LATEST_THRESHOLD = 10 * 60 * 1000; // 2 minutes

    for (const header of headerList) {
      const chain = header.getBlockchain();
      const height = header.getHeight();
      try {
        // check if we have this block
        await this.get(`${chain}.block.${height}`);
      } catch (_) {
        let from, to, chainLatest;
        // we dont have it // TODO check error type
        try {
          chainLatest = await this.get(`${chain}.block.latest`);
        } catch (_) {
          // we don't have chain latest - let's postpone the check because we can't do anything now
          continue;
        }

        // our latest block is older than 2 minutes from this header - probably starting
        if (header.getTimestamp() - chainLatest.getTimestamp() > TOO_OLD_LATEST_THRESHOLD) {
          this._logger.debug('Requested to fetch header older than 10 minutes');
          continue;
        }
        // our latest rovered is lower
        if (chainLatest.getHeight() < height) {
          const [previousFrom, previousTo] = boundaries[chain];

          if (!previousFrom || previousFrom.getHeight() > chainLatest.getHeight()) {
            from = chainLatest;
          }

          if (!previousTo || header.getHeight() > previousTo.getHeight()) {
            to = header;
          }

          boundaries[chain] = [from, to];
        } else {
          // find nearest lower we have
          let nearestLower, nearestHigher;

          let candidateHeight = header.getHeight() - 1;
          while (!nearestLower) {
            try {
              nearestLower = await this.get(`${chain}.block.${candidateHeight}`);
            } catch (_) {
              // TODO handle errors different than not found
              candidateHeight--;
            }
          }

          candidateHeight = header.getHeight() + 1;
          while (!nearestHigher) {
            try {
              nearestHigher = await this.get(`${chain}.block.${candidateHeight}`);
            } catch (_) {
              // TODO handle errors different than not found
              candidateHeight++;
            }
          }

          const [previousFrom, previousTo] = boundaries[chain];

          if (!previousFrom || previousFrom.getHeight() > nearestLower.getHeight()) {
            from = nearestLower;
          }

          if (!previousTo || nearestHigher.getHeight() > previousTo.getHeight()) {
            to = nearestHigher;
          }

          boundaries[chain] = [from, to];
        }
      }
    }

    // now we have boundaries for each chain, just filter them for empty cases
    return toPairs(boundaries).filter(([chain, [from, to]]) => {
      return from !== undefined && to !== undefined;
    });
  }

  /**
   * Sets a reorgFromBlock where the chain used to end and a reorgToBlock where the chain is supposed to end
   * return true is the blocks were set, returns false if a reorg event is already pending
   */
  async putReorgBlocks(reorgFromBlock, reorgToBlock, opts = {
    address: false,
    peer: false,
    blockchain: false,
    force: false
  }) {
    // bc.block.reorgfrom
    // bc.block.reorgto
    const blockchain = opts.blockchain ? opts.blockchain : BC_SUPER_COLLIDER;
    if (!reorgFromBlock || !reorgToBlock) {
      return Promise.resolve(false);
    }

    //debugWriteOperations(`putReorgBlocks() from block <- ${reorgFromBlock.getHeight()} : ${reorgFromBlock.getHash()}`)
    //if (!this._writeEventTable['putReorgBlocks']) {
    //  this._writeEventTable['putReorgBlocks'] = 0
    //}
    //this._writeEventTable['putReorgBlocks']++

    await this.processPeerExpiration();
    const prevReorgFromBlock = await this.get(`${blockchain}.block.reorgfrom`);
    const prevReorgToBlock = await this.get(`${blockchain}.block.reorgto`);
    const blocksAlreadySet = prevReorgFromBlock !== null && prevReorgToBlock !== null;
    const initialPeer = await this._engine.persistence.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
    const multiverseChanging = initialPeer;

    if (!opts.force && blocksAlreadySet && multiverseChanging) {
      // LDL
      debugReorg(`cannot trigger multiverse change while current change ${blockchain} ${prevReorgFromBlock.getHeight()} -> ${prevReorgToBlock.getHeight()} is in progress`);
      return Promise.resolve(false);
    }

    await this.put(`${blockchain}.block.reorgfrom`, reorgFromBlock);
    await this.put(`${blockchain}.block.reorgto`, reorgToBlock);
    await this.put(`${BC_SUPER_COLLIDER}.sync.edge`, parseInt(reorgToBlock.getHeight(), 10));

    if (opts.address && blockchain === BC_SUPER_COLLIDER && !initialPeer) {
      let currentPeer = new InitialPeer();
      currentPeer.setAddress(addressToHost(opts.address));
      currentPeer.setExpires(Number(new Date()) + BC_PEER_HEADER_SYNC_EXPIRE);
      currentPeer = await this.put(`${BC_SUPER_COLLIDER}.sync.initialpeer`, currentPeer);
      // LDL
      debugReorg(`multiverse change request successfully opened from ${reorgFromBlock.getHeight()} to ${reorgToBlock.getHeight()} for address ${opts.address}, edge: ${reorgToBlock.getHeight()}`);
    } else {
      // LDL
      debugReorg(`multiverse change request successfully opened from ${reorgFromBlock.getHeight()} to ${reorgToBlock.getHeight()}, edge: ${reorgToBlock.getHeight()}`);
    }

    return Promise.resolve({ from: parseInt(reorgFromBlock.getHeight(), 10) });
  }

  /**
   * If reorg blocks are available reorgs (putLatestBlock) to the reorgFromBlock and prunes (UTXO) starting at the reorgToBlock
   * Returns true if the reorg occured, false if it did not or an error occured
   */
  async reorgBlockchain(blockchain = BC_SUPER_COLLIDER, opts = {
    toBlock: false,
    fromBlock: false,
    iterateUp: true,
    peer: false,
    force: false,
    reorgTo: false
  }) {
    try {
      let reorgFromBlock = await this.get(`${blockchain}.block.reorgfrom`);
      const reorgToBlock = opts.toBlock ? opts.toBlock : await this.get(`${blockchain}.block.reorgto`);
      const synced = await this.get(`${blockchain}.sync.initialsync`);
      let latestBlock = false;

      if (opts.toBlock) {
        await this.putLatestBlock(opts.toBlock, BC_SUPER_COLLIDER, {
          iterateUp: false,
          chainState: this._chainState
        });
      }

      const tn = Date.now();

      if (!reorgFromBlock || !reorgToBlock) {
        debugOrg(`no pending changes to make in ${blockchain} multichain`);
        await this.del(`${blockchain}.block.reorgfrom`);
        await this.del(`${blockchain}.block.reorgto`);
        await this.put(`${blockchain}.sync.initialsync`, 'complete');
        return false;
      }

      // LDL
      this._logger.info(`organizing multiverse edge and latest block around height ${reorgFromBlock.getHeight()} to ${reorgToBlock.getHeight()}`);
      // remove any UTXOs from a previous sync
      await this.del(`${blockchain}.block.reorgfrom`);
      await this.del(`${blockchain}.block.reorgto`);

      if (opts.reorgTo) {
        reorgFromBlock = reorgToBlock;
        debugOrg(`moving multiverse to highest edge ${reorgToBlock.getHeight()}`);
      }

      // !!! note that put latest block is used here to iterate up from where the multiverse.entend set the original reorg from
      if (opts.fromBlock) {
        latestBlock = opts.fromBlock;
        reorgFromBlock = opts.fromBlock;
      } else if (synced !== 'complete' && !opts.reorgTo) {
        await this.put(`${blockchain}.sync.initialsync`, 'complete');
        const lb = await this.get(`${blockchain}.block.latest`);
        if (lb && parseInt(lb.getHeight(), 10) > parseInt(reorgFromBlock.getHeight(), 10)) {
          this._logger.info(`latest block set to edge ${lb.getHeight()}`);
          reorgFromBlock = lb;
        }
        await this.putLatestBlock(reorgFromBlock, BC_SUPER_COLLIDER, {
          iterateUp: opts.iterateUp,
          chainState: this._chainState
        });
      } else if (opts.reorgTo) {
        latestBlock = await this.putLatestBlock(reorgToBlock, BC_SUPER_COLLIDER, {
          iterateUp: opts.iterateUp,
          chainState: this._chainState
        });
      } else if (!opts.reorgTo && reorgFromBlock) {
        this._logger.info(`setting blockchain in complete state to edge ${reorgFromBlock.getHeight()}`);
        latestBlock = await this.putLatestBlock(reorgFromBlock, BC_SUPER_COLLIDER, {
          iterateUp: opts.iterateUp,
          chainState: this._chainState
        });
      }

      latestBlock = latestBlock || reorgFromBlock;
      if (synced === 'pending' && !opts.reorgTo) {
        // await this.put(`${BC_SUPER_COLLIDER}.data.latest`, `${max(1, parseInt(latestBlock.getHeight(), 10))}:${tn}`)
      } else if (synced === 'pending' && opts.reorgTo) {
        // await this.del(`${BC_SUPER_COLLIDER}.data.latest`)
      } else if (synced === 'complete' && opts.reorgTo) {
        // await this.del(`${BC_SUPER_COLLIDER}.data.latest`)
      }

      if (this._chainState && latestBlock && latestBlock.getHash) {
        if (new BN(latestBlock.getHeight()).toNumber() !== 1) {
          const previousHeight = new BN(latestBlock.getHeight()).sub(new BN(1)).toNumber();
          const previousHash = latestBlock.getPreviousHash();
          const lowestRangeHeight = opts.reorgTo ? parseInt(opts.reorgTo.getHeight(), 10) - 1 : parseInt(reorgFromBlock.getHeight(), 10) - 1;
          const lowestRangeHash = opts.reorgTo ? opts.reorgTo.getPreviousHash() : reorgFromBlock.getPreviousHash();
          debug(`updating chainstate lowest height ${previousHeight} lowest hash: ${latestBlock.getPreviousHash()}`);
          // set latest and highest height to the same block
          await Promise.all([this._chainState.putLatestBlock(blockchain, reorgFromBlock.getHeight(), latestBlock.getHash()), this.put(`${blockchain}.latestBlock.latest.hash`, reorgFromBlock.getHash()), this.put(`${blockchain}.latestBlock.latest.height`, new BN(reorgFromBlock.getHeight()).toNumber()), this.put(`${blockchain}.range.lowest.height`, lowestRangeHeight), this.put(`${blockchain}.range.lowest.hash`, lowestRangeHash), this.put(`${blockchain}.range.highest.height`, new BN(reorgFromBlock.getHeight()).toNumber()), this.put(`${blockchain}.range.highest.hash`, reorgFromBlock.getHash())]);
        }
      }

      return true;
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  /**
   * Checks if peer is expired, if NOT expired returns FALSE, if expired resets peer and sets edge == 1 and data.latest == 2 and returns TRUE, if no initial peer is set returns TRUE
   */
  async processPeerExpiration(opts = {}) {
    const currentPeer = await this.get(`${BC_SUPER_COLLIDER}.sync.initialpeer`);

    const time = Number(new Date());
    if (currentPeer && new BN(time).gt(new BN(currentPeer.getExpires()))) {
      // peer expired
      this._logger.info(`waypoint released, ${BC_SUPER_COLLIDER} new assignment created`);
      await this.del(`${BC_SUPER_COLLIDER}.sync.initialpeer`);
      //const waypointRequest = await this.get(`${BC_SUPER_COLLIDER}.req.range`)

      //if (waypointRequest) {
      //  const waypointRequestParts = waypointRequest.split(':')
      //  let waypointRequestHigh = parseInt(waypointRequestParts[0], 10)
      //  let waypointRequestLow = parseInt(waypointRequestParts[1], 10)
      //  let waypointRequestTime = parseInt(waypointRequestParts[2], 10)
      //}

      await this.reorgBlockchain(BC_SUPER_COLLIDER);
      return Promise.resolve(1);
    } else if (!currentPeer) {
      return Promise.resolve(false);
    } else if (currentPeer) {
      // LDL
      debug(`current peer assigned  ${currentPeer.getAddress()} <- ${currentPeer.getExpires()} (${parseInt(currentPeer.getExpires(), 10) - time})`);
      return Promise.resolve(false);
    } else {
      return Promise.resolve(false);
    }
  }

  async isValidBlockCached(newBlock, opts = { fullBlock: true }) {
    try {
      return Promise.resolve(true);
    } catch (_) {
      try {
        const valid = isValidBlock(newBlock, opts);
        await this.put('valid_' + newBlock.getHash(), valid);
        // return this block in wrhatever state it was validated
        return Promise.resolve(valid);
      } catch (err) {
        // error attempting to parse this as a block, reject
        this._logger.error(err);
        return Promise.resolve(false);
      }
    }
  }

  /**
   * Get transaction by it's hash
   * @param hash string
   * @param blockchain string
   */
  async getTransactionByHash(txHash, blockchain = 'bc', opts = {
    asBuffer: true,
    cached: true
  }) {
    const key = `${blockchain}.tx.${txHash}`;

    //debugReadOperations(`getTransactionByHash() ${key}`)
    //if (!this._readEventTable['getTransactionByHash']) {
    //  this._readEventTable['getTransactionByHash'] = 0
    //}
    //this._readEventTable['getTransactionByHash']++

    try {
      // if (opts.cached) {
      //   if (this._transactionByHashCache.has(`${blockchain}.tx.${txHash}`)) {
      //     if (this._transactionByHashCache.get(`${blockchain}.tx.${txHash}`)) {
      //       return this._transactionByHashCache.get(`${blockchain}.tx.${txHash}`)
      //     }
      //   }
      // }

      const tx = await this.get(key, { asBuffer: true });
      if (tx) {
        // this._transactionByHashCache.set(`${blockchain}.tx.${txHash}`, tx)
      } else {
        const id = `${blockchain}.txblock.${txHash}`;
        const key = await this.get(id);
        if (key) {
          // this._logger.info(`key is ${key}`)
          const [chain, _, hash, height] = key.split('.');
          const block = await this.getBlockByHash(hash, chain);
          if (block && block.getTxsList) {
            let txs = block.getTxsList().filter(tx => {
              return tx.getHash() === txHash;
            });
            if (txs.length === 1) {
              await this.putTransaction(txs[0], block.getHash(), 0, 'bc');
              return txs[0];
            }
          }
        }
      }
      return tx;
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  /**
   * Get Output by its tx hash and index
   *
   */
  async getOutputByHashAndIndex(txHash, index) {

    //debugReadOperations(`getOutputByHashAndIndex() ${txHash}`)
    //if (!this._readEventTable['getOutputByHashAndIndex']) {
    //  this._readEventTable['getOutputByHashAndIndex'] = 0
    //}
    //this._readEventTable['getOutputByHashAndIndex']++

    try {
      const tx = await this.getTransactionByHash(txHash, 'bc');
      if (tx) {
        return tx.getOutputsList()[index];
      }
      return null;
    } catch (err) {
      throw new Error(err);
    }
  }

  /**
   * Remove the transaction and any spent outpoints
   * @param tx Transaction
   * @param blockchain string
   */
  async delTransaction(tx, branch = 0, blockchain = 'bc', opts = {
    asBuffer: true,
    force: false
  }) {
    // remove blockchain.tx.txhash
    // remove blockchain.op.txHash.index[] (outpoints) delOutPointClaim
    try {
      if (is(String, tx)) {
        tx = await this.getTransactionByHash(tx, blockchain);
        if (!tx) return false;
      }
      const txKey = `${blockchain}.tx.${tx.getHash()}`;
      debug(`deleting ${txKey}`);
      // determine if transaction is marked or from Block Collider / Super Collider
      await this.del(txKey, opts);
      // this._transactionByHashCache.del(`${blockchain}.tx.${tx.getHash()}`)
      if (tx.getInputsList === undefined || tx.getOutputsList === undefined) {
        // transaction is marked
        return true;
      }
      // else if (branch !== undefined && branch === 0) {
      //   return await this.removeTxDetails(tx,blockchain)
      // }
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  async getNrgMintedSoFar() {
    return this.get(NRG_MINTED_PERISTENCE_KEY);
  }

  async setNrgMintedSoFar(nrg) {
    await this.put(NRG_MINTED_PERISTENCE_KEY, nrg);
  }

  /**
   * Put transaction data on disk
   * @param tx Transaction
   * @param blockHash string
   * @param branch Number
   */
  async putTransaction(tx, blockHash, branch = 0, blockchain = 'bc', opts = {
    asBuffer: true,
    force: false
  }) {
    try {
      // if blockchain specified for transaction
      if (tx.getId !== undefined) {
        blockchain = tx.getId();
      }
      const key = `${blockchain}.tx.${tx.getHash()}`;
      let saved = await this.get(key);
      if (saved) return true;
      debugPutTransaction(`${key} is being saved`);
      await this.put(key, tx, opts);
      // this._transactionByHashCache.set(key, tx)
      return true;
    } catch (err) {
      this._logger.info(`err saving ${tx.getHash()} within ${blockHash}`);
      this._logger.error(err);
      return false;
    }
  }

  /**
   * Loads the blocks that contain the given child block
   * @param block BcBlock
   * @param blockchain
   */
  async getBlocksByChildHash(hash, blockchain, opts = {
    asBuffer: true,
    asHeader: true
  }) {

    //debugReadOperations(`getBlocksByChildHash() ${blockchain}:${hash}`)
    //if (!this._readEventTable['getBlocksByChildHash']) {
    //  this._readEventTable['getBlocksByChildHash'] = 0
    //}
    //this._readEventTable['getBlocksByChildHash']++

    if (!hash || !blockchain) {
      return Promise.reject(new Error('hash and blockchain required <- blockchain headers not available'));
    }

    try {
      const key = `${blockchain}.child.${hash}`;
      const hashes = await this.get(key);
      if (!hashes) {
        return Promise.resolve(null);
      }
      return Promise.all(hashes.map(headerHash => {
        return this.getBlockByHash(headerHash, BC_SUPER_COLLIDER, opts);
      })).then(flatten);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /**
   * Index of Overline block hashes by their children
   * @param block BcBlock
   * @param blockchain
   */
  async getMarkedUncles(block, childChain = 'eth', blockchain = 'bc', opts = {
    asBuffer: true
  }) {

    try {

      if (!block || !block.getBlockchainHeaders) {
        return Promise.reject(new Error(`given block is malformed <- blockchain headers not available`));
      }

      const blockchain = block.getBlockchain ? block.getBlockchain() : BC_SUPER_COLLIDER;
      let prevBlock = await this.getBlockByHash(block.getPreviousHash(), blockchain);
      if (!prevBlock) {
        debugPrevUncles(`unable to find previous block ${block.getHeight() - 1}:${block.getPreviousHash()}`);
        prevBlock = await this.getBlockByHeight(parseInt(block.getHeight() - 1, 10), blockchain);
        if (!prevBlock) {
          debugPrevUncles(`unable to find  previous block ${block.getHeight() - 1}:${block.getPreviousHash()}`);
          return Promise.reject(new Error('unable to get previous block from given ${block.getHeight()}'));
        }
        if (prevBlock.getHash() !== block.getPreviousHash()) {
          debugPrevUncles(`unable to find match previous block ${block.getHeight() - 1}:${block.getPreviousHash()}`);
          return Promise.reject(new Error('unable to find matching previous block from given ${block.getHeight()}'));
        }
      }

      debugPrevUncles(`checking uncles of ${block.getHeight()}:${block.getHash()} -> ${prevBlock.getHeight()}:${prevBlock.getHash()}`);

      const blockChildren = sortBlocks(getChildBlocks(block, childChain), 'desc');
      const prevBlockChildren = sortBlocks(getChildBlocks(prevBlock, childChain), 'desc');

      debugPrevUncles(`${block.getHeight()} has ${blockChildren.length} children -> ${prevBlock.getHeight()} has ${prevBlockChildren.length}`);

      if (blockChildren.length === 1 && prevBlockChildren.length === 1) {
        // if its the same children
        if (blockChildren[0].getHash() === prevBlockChildren[0].getHash()) {
          debugPrevUncles(`${block.getHeight()} matching childrend with previous block`);
          return false;

          // if its two different blocks
        } else if (blockChildren[0].getPreviousHash() !== prevBlockChildren[0].getHash()) {
          return prevBlockChildren;
        }
      }

      const uncleChildren = [];
      for (const prev of prevBlockChildren) {
        let notfound = false;
        debugPrevUncles(`searching for mount of ${childChain} -> ${prev.getHeight()} ${prev.getHash().slice(0, 8)}...`);
        for (const child of blockChildren) {
          if (notfound) continue;
          notfound = child.getHash() === prev.getHash() || child.getPreviousHash() === prev.getHash();
          if (notfound) {
            debugPrevUncles(`mount found for ${childChain} -> ${prev.getHeight()} ${prev.getHash().slice(0, 8)}...`);
          }
        }
        if (!notfound) {
          uncleChildren.push(prev);
        }
      }

      debugPrevUncles(`${uncleChildren.length} marked blocks to remove`);
      if (uncleChildren.length === 0) {
        return false;
      }
      return uncleChildren;
    } catch (e) {
      this._logger.error(err);
      return Promise.reject(e);
    }
  }

  /**
   * Index of Overline block hashes by their children
   * @param block BcBlock
   * @param blockchain
   */
  async putChildBlocksIndexFromBlock(block, blockchain = 'bc', opts = {
    asBuffer: true,
    storeOnlyOne: false
  }) {
    if (!block || !block.getBlockchainHeaders) {
      return Promise.reject(new Error('given block is malformed <- blockchain headers not available'));
    }

    //debugWriteOperations(`putChildBlocksIndexFromBlock(): ${blockchain} ${block.getHeight()}:${block.getHash()} `)
    //if (!this._writeEventTable['putChildBlocksIndexFromBlock']) {
    //  this._writeEventTable['putChildBlocksIndexFromBlock'] = 0
    //}
    //this._writeEventTable['putChildBlocksIndexFromBlock']++

    try {
      const headersMap = block.getBlockchainHeaders();
      const headers = Object.keys(headersMap.toObject()).reduce((all, listName) => {
        const getMethodName = `get${listName[0].toUpperCase()}${listName.slice(1)}`;
        const chainHeaders = headersMap[getMethodName]();
        return all.concat(sortBlocks(chainHeaders));
      }, []);

      let puts = [];
      for (const header of headers) {
        if (header.getBlockchain && header.getBlockchain() === 'btc' && parseInt(header.getHeight(), 10) >= 671020 && parseInt(header.getHeight(), 10) <= 699990) {
          continue;
        } else if (header.getBlockchain && header.getBlockchain() === 'eth' && parseInt(block.getHeight(), 10) >= 3498110 && parseInt(block.getHeight(), 10) <= 3509199) {
          continue;
        } else if (header.getBlockchain && header.getBlockchain() === 'eth' && parseInt(block.getHeight(), 10) > 3520524 && parseInt(header.getHeight(), 10) === 12269862) {
          continue;
        } else {

          const childKey = `${header.getBlockchain()}.child.${header.getHash()}`;
          // debug(`storing index ${childKey.slice(0, 21)}... for block ${block.getHeight()}`)
          const hashes = await this.get(childKey);
          if (!hashes) {
            // debug(`no hashes found for ${childKey.slice(0, 21)}`)
            puts.push([childKey, [block.getHash()]]);
          } else if (hashes.indexOf(block.getHash()) < 0) {
            // debug(`${hashes.length} hashes found for ${childKey.slice(0, 21)}`)
            hashes.push(block.getHash());
            puts.push([childKey, hashes]);
          }
        }
      }

      await this.putBulk(puts);
      return Promise.resolve(true);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /**
   * Store of valid block headers from Block Collider or connected chains, block must not be on disk
   * @param hash BcBlock
   * @param height
   * @param blockchain string
   */
  async putBlockHashAtHeight(blockHash, height, blockchain = 'bc', opts = {
    asBuffer: true,
    storeOnlyOne: false
  }) {

    return new Promise(async (resolve, reject) => {

      const key = `${blockchain}.height.${height}`;
      const indexKey = `${blockchain}.height.${height}.${blockHash}`;

      //debugWriteOperations(`putBlockHashAtHeight(): ${key}`)
      //if (!this._writeEventTable['putBlockHashAtHeight']) {
      //  this._writeEventTable['putBlockHashAtHeight'] = 0
      //}
      //this._writeEventTable['putBlockHashAtHeight']++

      try {
        let change = false;
        let hashes = await this.get(key, opts);
        if (!hashes) {
          change = true;
          hashes = [];
        } else if (hashes.indexOf(blockHash) > -1) {
          // block already exists at height
          return resolve(true);
        } else {
          if (!Array.isArray(hashes)) {
            hashes = hashes.split(',');
          }
        }

        if (change) {
          hashes.push(blockHash);
          await this.put(key, hashes.join(','), opts);
        } else {
          hashes.push(blockHash);
          await this.put(key, hashes.join(','), opts);
        }
        return resolve(true);
        return true;
      } catch (err) {
        this._logger.error(err);
        return resolve(false);
      }
    });
  }

  /**
   * Delete block hash from height
   * @param height number
   * @param blockchain string
   * @param hash string
   */
  async delHashAtHeight(height, blockchain, hash, opts = { asBuffer: true }) {
    const key = `${blockchain}.height.${height}`;
    const indexKey = `${blockchain}.height.${height}.${hash}`;
    try {
      const change = false;
      this._blockHashAtHeightCache.del(indexKey);
      let hashes = await this.get(key, opts);
      if (!hashes) {
        return true;
      }
      if (hashes.indexOf(hash) < 0) {
        return true;
      }
      if (typeof hashes === 'string' || hashes instanceof String) {
        hashes = hashes.split(',');
      }
      hashes.splice(hashes.indexOf(hash), 1);
      await this.put(key, hashes.join(','), opts);
      return true;
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  /**
   * Associates the transaction with a block. Used for both side branch and main branch chains.
   * @param tx string
   * @param blockHash string
   * @param blockchain string
   */
  async putTransactionBlockIndex(txHashes, blockHash, blockHeight, branch = 0, blockchain = 'bc', opts = { asBuffer: true }) {
    const key = `${blockchain}.txs.${blockHash}`;

    //debugWriteOperations(`putTransactionBlockIndex(): ${key}`)
    //if (!this._writeEventTable['putTransactionBlockIndex']) {
    //  this._writeEventTable['putTransactionBlockIndex'] = 0
    //}
    //this._writeEventTable['putTransactionBlockIndex']++

    try {
      const _this = this;
      const bulk = await this.putBulk(txHashes.map(hash => {
        // _this._blockByTxCache.set(`${blockchain}.txblock.${hash}`, `${blockchain}.block.${blockHash}.${blockHeight}`)
        return [`${blockchain}.txblock.${hash}`, `${blockchain}.block.${blockHash}.${blockHeight}`];
      }));
      await this.put(key, txHashes, opts);
      return true;
    } catch (e) {
      return true;
    }
  }

  /**
   * Attempt to get block at a depth below a block
   * @param block BcBlock||Block
   * @param targetHeight number
   */
  async getBlockAtDepthFromBlock(block, targetHeight = 1, opts = { asBuffer: true, depth: 1 }) {
    const blockchain = block.getBlockchain ? block.getBlockchain() : BC_SUPER_COLLIDER;
    const givenHeight = parseInt(block.getHeight(), 10);
    targetHeight = max(2, targetHeight);
    if (targetHeight >= givenHeight) {
      debug('returning default block');
      return block;
    } else if (givenHeight < 2) {
      this._logger.info('returning block as it is genesis block');
      return block;
    }

    //debugReadOperations(`getBlockAtDepthFromBlock() ${block.getHeight()}:${block.getHash()}`)
    //if (!this._readEventTable['getBlockAtDepthFromBlock']) {
    //  this._readEventTable['getBlockAtDepthFromBlock'] = 0
    //}
    //this._readEventTable['getBlockAtDepthFromBlock']++

    debug(`searching for previous block by hash ${block.getPreviousHash()} ${blockchain}`);
    const prevBlock = await this.getBlockByHash(block.getPreviousHash(), blockchain);
    if (prevBlock) {
      if (opts && opts.depth) {
        opts.depth++;
      }
      return this.getBlockAtDepthFromBlock(prevBlock, targetHeight, opts);
    } else {

      const blocksTraversed = opts && opts.depth ? opts.depth : 1;

      if (block.getBlockchain) {
        this._logger.info(`cannot find previous block ${block.getPreviousHash()} after iterating ${blocksTraversed} blocks`);
        this._logger.info(`returning block at height ${block.getHeight()} from target height ${targetHeight}`);
        return Promise.resolve(block);
      }

      const bls = await this.getBlocksByHeight(parseInt(block.getHeight(), 10) - 1, BC_SUPER_COLLIDER);
      if (bls) {
        let found = false;
        for (let b of bls) {
          if (found) continue;
          if (b && b.getHash() === block.getPreviousHash()) {
            found = b;
          }
        }
        if (found) {
          const key = `${blockchain}.block.${found.getHash()}`;
          await this.put(key, found);
          return this.getBlockAtDepthFromBlock(found, targetHeight, opts);
        }
        this._logger.info(`cannot find previous block ${block.getPreviousHash()} after iterating ${blocksTraversed} blocks`);
        this._logger.info(`returning block at height ${block.getHeight()} from target height ${targetHeight}`);
        return Promise.resolve(block);
      }
    }
  }

  /**
   * Attempt to put block at the edge of the chain, unless it completes hight blocks
   * @param block BcBlock||Block
   * @param blockchain string
   */
  async getRootedBlockFromBlock(block, chainToReturn = [], opts = { asBuffer: true, returnParents: false, depth: 0 }) {
    const blockchain = block.getBlockchain ? block.getBlockchain() : BC_SUPER_COLLIDER;

    debug(`search for root block by hash ${block.getPreviousHash()} ${blockchain}`);

    //debugReadOperations(`getRootedBlockFromBlock() ${block.getHeight()}:${block.getHash()}`)
    //if (!this._readEventTable['getRootedBlockFromBlock']) {
    //  this._readEventTable['getRootedBlockFromBlock'] = 0
    //}
    //this._readEventTable['getRootedBlockFromBlock']++

    const indexKey = `${block.getPreviousHash()}:${block.getHash()}`;
    if (this._inlineBlockCache.has(indexKey)) {
      return this._inlineBlockCache.get(indexKey);
    }

    let prevBlock = await this.getBlockByHash(block.getPreviousHash(), blockchain);
    if (!prevBlock) {

      const bls = await this.getBlocksByHeight(parseInt(block.getHeight(), 10) - 1, BC_SUPER_COLLIDER);
      if (bls) {
        for (let b of bls) {
          if (prevBlock) continue;
          if (b.getHash() === block.getPreviousHash()) {
            prevBlock = b;
          }
        }
        if (prevBlock) {
          const key = `${blockchain}.block.${prevBlock.getHash()}`;
          await this.put(key, prevBlock);
        }
      }
    }

    if (prevBlock) {
      chainToReturn.push(prevBlock);

      const key = `${blockchain}.child.${prevBlock.getHash()}`;
      debug(`searching for ${BC_SUPER_COLLIDER} block by key ${key.slice(0, 21)}`);
      const parentBlockHashes = await this.get(key);

      if (!parentBlockHashes) {
        this._logger.info('no child key found continuing search...');
        if (opts && opts.depth) {
          opts.depth++;
        }
        if (opts && opts.depth > 964) {
          this._logger.warn(`maximum depth search failed to find mountable parents ${prevBlock.getHeight()}`);
          return Promise.resolve(null);
        }
        return this.getRootedBlockFromBlock(prevBlock, chainToReturn, opts);
      } else {
        if (opts.returnParents) {
          // LDL
          debug(`returning ${parentBlockHashes.length} parents `);
          return Promise.resolve(parentBlockHashes);
        }
        debug(`child key found parents ${key.slice(0, 21)}`);

        this._inlineBlockCache.set(indexKey, chainToReturn);
        return Promise.resolve(chainToReturn);
      }
    } else {

      this._logger.info(`cannot find previous block ${block.getPreviousHash()}`);
      if (!chainToReturn || chainToReturn.length < 1) {
        return Promise.resolve(null);
      }
      if (opts.returnParents) {
        return Promise.resolve(null);
      }
      return Promise.resolve(chainToReturn);
    }
  }

  /**
   * Builds a child chain backwards until the previous hash references a block in the main chain
   * @param hash BcBlock
   * @param blockchain
   */
  async getRootedChainFromHash(hash, blockchain, opts = {
    latestBlock: false,
    asBuffer: true,
    asHeader: true,
    returnParents: false
  }) {
    if (!hash || !blockchain) {
      return Promise.reject(new Error('getChainToRootFromHash(): hash and blockchain are required'));
    }

    //debugReadOperations(`getRootedChainFromHash() ${blockchain}:${hash}`)
    //if (!this._readEventTable['getRootedChainFromHash']) {
    //  this._readEventTable['getRootedChainFromHash'] = 0
    //}
    //this._readEventTable['getRootedChainFromHash']++

    try {
      opts.asHeader = true;
      const latestBlock = opts.latestBlock ? opts.latestBlock : await this.get(`${BC_SUPER_COLLIDER}.block.latest`);
      const getBlocksDesc = async (h, b, blocks) => {
        const key = `${blockchain}.child.${h}`;
        const childBlock = await this.getBlockByHash(h, b);
        if (!childBlock) {
          return Promise.resolve(null);
        }
        const parentBlocks = await this.get(key);
        if (!parentBlocks) {
          // keep searching
          blocks.unshift(childBlock);
          return getBlocksDesc(childBlock.getPreviousHash(), b, blocks);
        } else {
          if (opts.returnParents) {
            return Promise.resolve(parentBlocks);
          }
          return Promise.resolve(blocks);
        }
      };

      const chain = await getBlocksDesc(hash, blockchain, []);
      if (!chain || chain.length < 1) {
        return Promise.resolve(null);
      }
      return Promise.resolve(chain);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /**
   * Attempt to put block at the edge of the chain, unless it completes hight blocks
   * @param block BcBlock||Block
   * @param blockchain string
   */
  async putLatestBlock(block, defaultBlockchain = 'bc', opts = {
    asBuffer: true,
    previousBlock: false,
    reloadTxs: false,
    saveHeaders: false,
    iterateUp: false,
    context: false
  }) {

    opts.iterateUp = false;
    //debugWriteOperations(`putLatestBlock() ${defaultBlockchain} ${block.getHeight()}:${block.getHash()}`)
    //if (!this._writeEventTable['putLatestBlock']) {
    //  this._writeEventTable['putLatestBlock'] = 0
    //}
    //this._writeEventTable['putLatestBlock']++

    if (!block || !block.getHash) {
      return Promise.reject(new Error('malformed block'));
    }
    // quickly update chainstaet
    const blockchain = block.getBlockchain ? block.getBlockchain() : defaultBlockchain;

    try {

      let blockAlreadySaved = false;
      if (blockchain === BC_SUPER_COLLIDER) {
        if (parseInt(block.getHeight(), 10) % 100 === 0) {
          const currentSyncedStatus = await this.get(`${BC_SUPER_COLLIDER}.sync.initialsync`);
          if (currentSyncedStatus && currentSyncedStatus === 'complete') {
            // select tree
            //await this.pruneFromBlock(block, 160, 160)
          }
        }
      }

      if (opts.iterateUp && blockchain === BC_SUPER_COLLIDER) {
        const givenHeight = parseInt(block.getHeight(), 10) + 1;
        const potentialHigherBlocks = await this.getBlocksByHeight(givenHeight, blockchain);
        let fastBlock = false;
        if (opts.reloadTxs) {
          if (this._blockByHeightCache.has(`${blockchain}.block.${parseInt(block.getHeight(), 10)}`)) {
            fastBlock = this._blockByHeightCache.get(`${blockchain}.block.${parseInt(block.getHeight(), 10)}`);
            if (fastBlock.getHash() === block.getHash()) {
              block = fastBlock;
            }
          } else {
            fastBlock = await this.getBlockByHash(block.getHash(), blockchain);
            if (fastBlock) {
              block = fastBlock;
            }
          }
        }
        if (opts.iterateUp && potentialHigherBlocks) {
          debugLatest(`putLatestBlock(): found ${potentialHigherBlocks.length} hashes at POTENTIAL next ${blockchain} height ${givenHeight}`);
        } else {
          debugLatest(`putLatestBlock(): found 0 hashes at POTENTIAL next ${blockchain} height ${givenHeight}`);
        }

        if (opts.iterateUp && potentialHigherBlocks && potentialHigherBlocks.length > 0) {
          debugLatest(`potential higher blocks from ${givenHeight}`);
          const higherBlocks = potentialHigherBlocks.reduce((all, b) => {
            if (b && b.getPreviousHash && b.getPreviousHash() === block.getHash()) {
              all.push(b);
            }
            return all;
          }, []);

          if (higherBlocks && higherBlocks.length > 0) {
            debugLatest(`putLatestBlock() higher blocks discovered ${parseInt(block.getHeight(), 10) + 1} -> ${higherBlocks.length} candidates`);

            // ensure full block is returned with txs in the next evaluation

            /*
             * Optionally add the current block to use as a cache when evaluating the next highest
             */
            if (!opts.previousBlock || opts.previousBlock.getHash() !== block.getPreviousHash()) {
              if (new BN(block.getHeight()).toNumber() !== 2) {
                let cachedBlock = false;
                if (this._blockByHeightCache.has(`${blockchain}.block.${parseInt(block.getHeight(), 10) - 1}`)) {
                  cachedBlock = this._blockByHeightCache.get(`${blockchain}.block.${parseInt(block.getHeight(), 10) - 1}`);
                }
                if (!cachedBlock || cachedBlock.getHash() !== block.getPreviousHash()) {
                  const prevBlock = await this.getBlockByHash(block.getPreviousHash(), blockchain);
                  if (prevBlock) {
                    await this.put(`${blockchain}.block.${prevBlock.getHeight()}`, prevBlock);
                  }
                }
                // pass the current block forward to the next
                opts.previousBlock = block;
              }
            }

            if (blockchain === BC_SUPER_COLLIDER) {
              blockAlreadySaved = true;
              await this.putBlock(block, 0, blockchain, { saveHeaders: opts.context !== 'local' });
            }

            const validCandidates = [];
            for (const b of higherBlocks) {
              validCandidates.push(b);
            }

            // we can only proceed knowingly up if there is only one valid candidate
            // otherwise we stop latest height and weight for sync to complete
            if (validCandidates.length === 1) {
              opts.reloadTxs = true;
              /*
               * Optionally add the current block to use as a cache when evaluating the next highest
               */
              if (!opts.previousBlock || opts.previousBlock.getHash() !== block.getPreviousHash()) {
                if (new BN(block.getHeight()).toNumber() !== 2) {
                  let cachedBlock = false;
                  if (this._blockByHeightCache.has(`${blockchain}.block.${parseInt(block.getHeight(), 10) - 1}`)) {
                    cachedBlock = this._blockByHeightCache.get(`${blockchain}.block.${parseInt(block.getHeight(), 10) - 1}`);
                  }
                  if (!cachedBlock || cachedBlock.getHash() !== block.getPreviousHash()) {
                    const prevBlock = await this.getBlockByHash(block.getPreviousHash(), blockchain);
                    if (prevBlock && prevBlock.getHash) {
                      this._blockByHeightCache.set(`${blockchain}.block.${parseInt(block.getHeight(), 10) - 1}`, prevBlock);
                      await this.put(`${blockchain}.block.${prevBlock.getHeight()}`, prevBlock);
                    }
                  }
                  // pass the current block forward to the next
                  opts.previousBlock = block;
                }
              }
              // require the selected best block to have the most recent UTXOs
              return this.putLatestBlock(validCandidates[0], blockchain, opts);
            }
          }
        }
      }

      if (block && block.getHash) {
        await this.put(`${blockchain}.block.latest`, block);
        // prevent the block from being saved twice
        //twiceif (!blockAlreadySaved) {
        //twice  await this.putBlock(block, 0, blockchain, {saveHeaders: opts.context !== 'local'})
        //twice}
      }

      //const edge = await this.get(`${blockchain}.sync.edge`)
      //if (!edge) {
      //  await this.put(`${blockchain}.sync.edge`, parseInt(block.getHeight(), 10))
      //} else if (new BN(edge).lt(new BN(block.getHeight()))) {
      //  await this.put(`${blockchain}.sync.edge`, parseInt(block.getHeight(), 10))
      //}

      if (this._chainState && block && block.getHash) {
        if (new BN(block.getHeight()).toNumber() !== 1) {
          const previousHeight = new BN(block.getHeight()).sub(new BN(1)).toNumber();
          const previousHash = block.getPreviousHash();
          debug(`updating chainstate lowest height ${previousHeight} lowest hash: ${block.getPreviousHash()}`);
          // set latest and highest height to the same block
          await Promise.all([this._chainState.putLatestBlock(blockchain, block.getHeight(), block.getHash()), this._chainState._persistence.put(`${blockchain}.block.latest.hash`, block.getHash()), this._chainState._persistence.put(`${blockchain}.block.latest.height`, new BN(block.getHeight()).toNumber()), this._chainState._persistence.put(`${blockchain}.range.lowest.height`, new BN(block.getHeight()).toNumber() - 1), this._chainState._persistence.put(`${blockchain}.range.lowest.hash`, block.getPreviousHash()), this._chainState._persistence.put(`${blockchain}.range.highest.height`, new BN(block.getHeight()).toNumber()), this._chainState._persistence.put(`${blockchain}.range.highest.hash`, block.getHash())]);
        }
      }

      debugLatest(`putLatestBlock(): ${blockchain} block [] ${block.getHeight()} now set as latest block`);
      // MMM !!! following block cache
      // add function here to make sure that the BC block matches this sequence of blocks
      // if saveHEaders is true put the latest header block
      if (blockchain === BC_SUPER_COLLIDER && opts.saveHeaders) {
        const putLatestHeadersOpts = {
          asBuffer: true,
          context: context,
          saveHeaders: false,
          iterateUp: opts.iterateUp
        };
        const headersMap = block.getBlockchainHeaders();
        const headers = Object.keys(headersMap.toObject()).reduce((all, listName) => {
          const getMethodName = `get${listName[0].toUpperCase()}${listName.slice(1)}`;
          const chainHeaders = headersMap[getMethodName]();
          return all.concat(sortBlocks(chainHeaders));
        }, []);
        await Promise.all(headers.map(header => this.putLatestBlock(header, header.getBlockchain(), putLatestHeadersOpts))); // put child blocks
      }
      return Promise.resolve(block);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  extractMintedNRG(newBlock) {
    let mintedNrg = new _decimal.Decimal(0);
    if (newBlock.getHeight() == 1) {
      const txOutputs = newBlock.getTxsList()[0].getOutputsList();
      for (const output of txOutputs) {
        mintedNrg = mintedNrg.add(new _decimal.Decimal(internalToHuman(output.getValue(), NRG)));
      }
    } else {
      const txs = newBlock.getTxsList();
      const coinbaseTx = txs[0];
      const minerRewardBN = internalToBN(coinbaseTx.getOutputsList()[0].getValue(), BOSON);
      const blockTxs = txs.slice(1);
      const txFeesBN = blockTxs.map(tx => calcTxFee(tx)).reduce((fee, sum) => sum.add(fee), new BN(0));
      mintedNrg = new _decimal.Decimal(internalToHuman(minerRewardBN.sub(txFeesBN), NRG));
    }
    return mintedNrg;
  }

  async calculateNRGSupply() {
    let block = await this.get('bc.block.latest');
    let mintedNrgTotal = new _decimal.Decimal(0);
    while (block) {
      mintedNrgTotal = mintedNrgTotal.add(this.extractMintedNRG(block));
      let prev = block.getPreviousHash();
      let height = block.getHeight();
      block = await this.getBlockByHash(prev, 'bc');
      if (!block) {
        block = await this.getBlockByHeight(height - 1, 'bc');
        let blocks = await this.getBlocksByHeight(height - 1, 'bc');
        if (blocks) blocks = blocks.filter(b => {
          return b.getHash() === prev;
        });
        if (blocks.length === 1) block = blocks[0];
      }
    }
    await this.setNrgMintedSoFar(mintedNrgTotal.toString());
  }

  async areUTXOsSavedForBlock(height, hash) {
    const saved = await this.get(`bc.block.${height}.utxoSaved`);
    return saved === hash;
  }

  async removeUTXOsFrom(height) {
    let lastSavedBlock = await this.get('bc.block.last.utxoSaved');
    if (lastSavedBlock) {
      //just remove the last block if the same height as the latest
      if (lastSavedBlock.getHeight() === height) {
        let success = await this.updateUTXOs(lastSavedBlock, true);
        return success;
      }
      //else if the latest block saved is heigher than the removal request,
      //traverse down the blocks
      else if (lastSavedBlock.getHeight() > height) {
          let block = lastSavedBlock;
          let blocksToRemove = [block];

          for (let i = lastSavedBlock.getHeight(); i > height; i--) {
            if (block) block = await this.getBlockByHash(block.getPreviousHash());
            if (block) blocksToRemove.push(block);
          }

          for (let i = 0; i < blocksToRemove.length; i++) {
            const removeBlock = blocksToRemove[i];
            let success = await this.updateUTXOs(removeBlock, true);
            if (!success) return false;
          }
        }
    }
    return true;
  }

  async putLoop() {
    const wait = await this.get(`_`);
    this._logger.info(`wait: ${wait}`);
    if (!wait) {
      await this.put(`_`, `${1}`);
      this._engine._.emit('e');
      return 1;
    } else {
      this._engine._.emit('e');
      return parseInt(wait, 10);
    }
  }

  async updateUTXOs(block, remove = false) {
    let date = Date.now();
    //if we're about to add utxos for a block and save it, check that the child blocks pass
    if (!remove) {
      const childBlockPassesRoveredBlock = await this.putBlockPassesRoverTest(block);
      if (!childBlockPassesRoveredBlock) {
        this._logger.info(`block ${block.getHeight()} failed childBlockPassesRoveredBlock`);
        return false;
      }
      await this.saveBlock(block);
    }
    // debugUTXO(`calling ${remove ? 'REMOVING' : 'SAVING'} on ${block.getHeight()}:${shortenHash(block.getHash())}`)
    // remove event loop timeline
    //const unlink = await this.putLoop()
    //this._logger.info(`unlink: ${unlink}`)

    let lastSavedBlock = await this.get('bc.block.last.utxoSaved');
    if (!lastSavedBlock && block.getHeight() !== 1) return false;
    let isUpdating = await this.get(`updateUTXOs`);

    if (isUpdating === `${remove ? 'REMOVING' : 'SAVING'}.${block.getHash()}`) {
      debugUTXO(`running update on ${block.getHash()}`);
    } else if (lastSavedBlock) {
      // check if block being evaluated is in order
      if (remove && lastSavedBlock.getHash() !== block.getHash()) {
        return false;
      }

      if (!remove && lastSavedBlock.getHash() !== block.getPreviousHash()) {
        return false;
      }
    }

    //check if another block is being saved right now
    if (isUpdating) debugUTXO(`isUpdating is ${isUpdating}`);
    if (isUpdating && isUpdating !== `${remove ? 'REMOVING' : 'SAVING'}.${block.getHash()}`) {
      debugUTXO(`in the midst of an update of ${isUpdating} while evaluating ${block.getHeight()}:${shortenHash(block.getHash())}`);
      return false;
    } else {
      await this.put(`updateUTXOs`, `${remove ? 'REMOVING' : 'SAVING'}.${block.getHash()}`);
    }

    const txs = await this.getUnspentAndSpentForBlock(block);
    if (txs === false) {
      await this.del(`updateUTXOs`);
      return false;
    }
    const { utxos, stxos } = txs;

    //save each utxo for each script type
    for (let i = 0; i < Object.keys(utxos).length; i++) {
      let scriptType = Object.keys(utxos)[i];
      if (scriptType == 'taker_output' && utxos[scriptType].length > 0) {
        if (remove) await this.delBlockHasTaker(block.getHeight());else await this.setBlockHasTaker(block.getHeight());
      }
      await this.addUTXO(scriptType, remove ? stxos[scriptType] : utxos[scriptType], block); // utxo
      await this.delUTXO(scriptType, remove ? utxos[scriptType] : stxos[scriptType], block); // utxo
    }

    //remove the settling of any trades that occured during this block
    if (remove) {
      await this._unsettledTxManager.removeBcBlock(block);
      let prevBlock = await this.getBlockByHash(block.getPreviousHash(), 'bc');
      await this.put('bc.block.last.utxoSaved', prevBlock);
      await this.del(`bc.block.${block.getHeight()}.utxoSaved`);
    }
    // settle any trades that occured during this block
    else {
        this._engine._txPendingPool.markTxsAsMined(block.getTxsList());
        await this._unsettledTxManager.onNewBcBlock(block);
        await this.put('bc.block.last.utxoSaved', block);
        await this.put(`bc.block.${block.getHeight()}.utxoSaved`, block.getHash());

        // let highestInSequence = await this.get('bc.block.highest.sequence')
        // if(!highestInSequence) await this.put('bc.block.highest.sequence', block)
        //update highest if new block is heigher or of same height/diff hash
        // else if (highestInSequence.getHeight() < block.getHeight() || (highestInSequence.getHeight() === block.getHeight() && highestInSequence.getHash() !== block.getHash())) {
        // this._logger.info(`highest in sequence block is ${block.getHeight()}:${block.getHash()}`)
        // await this.put('bc.block.highest.sequence', block)
        // }
      }

    await this.del(`updateUTXOs`);

    for (const scriptType of Object.keys(utxos)) {
      await this.del(`utxo.${scriptType}.length.${block.getHash()}`);
    }

    // resume event loop timeline
    //const link = await this.putLoop()
    //this._logger.info(`link: ${link}`)
    //this._logger.info(`link + 1: ${link}`)

    if (lastSavedBlock) debugUTXO(`${remove ? 'REMOVING' : 'SAVING'} took ${(Date.now() - date) / 1000} sec for ${block.getHeight()}:${shortenHash(block.getHash())}:${shortenHash(block.getPreviousHash())}, LAST is ${lastSavedBlock.getHeight()}:${shortenHash(lastSavedBlock.getHash())}`);

    if (remove) {
      for (const tx of block.getTxsList()) {
        debugUTXO(`reading ${tx.getHash()}`);
        if (tx && tx.getInputsList && tx.getInputsList().length !== 0) this._engine._txPendingPool.tryAddingNewTx(tx);
      }
    }

    return true;

    //if (unlink === link + 1) {
    //  // resume
    //  return true
    //} else {
    //  // wait
    //  return false
    //}
  }

  async setBlockHasTaker(height) {
    const lastBlock = await this.get('bc.block.lastTaker');
    await this.put('bc.block.lastTaker', height);
  }

  async delBlockHasTaker(height) {
    const newLastBlock = await this.get(`bc.block.taker.${height}`);
    if (newLastBlock) {
      await this.put('bc.block.lastTaker', newLastBlock);
    }
    await this.del(`bc.block.taker.${height}`);
  }

  //GET Unspent and Spent Transactions Within Block
  async getUnspentAndSpentForBlock(block) {
    try {
      const utxos = { nrg_transfer: [], maker_output: [], taker_output: [], taker_callback: [] };
      const stxos = { nrg_transfer: [], maker_output: [], taker_output: [], taker_callback: [] };

      await Promise.all(block.getTxsList().map(tx => {
        return this.getTxData(tx, utxos, stxos, block.getHash());
      }));

      return { utxos, stxos };
    } catch (err) {
      this._logger.info(`err in getUnspentAndSpentForBlock ${err}`);
      return false;
    }
  }

  async getTxFromInput(txInput) {

    //exception
    if (txInput.getHash() === '4f296ca2410f5676aeae3fad19270bc69661f461a55f4e1ea94a64cb1c756f81' || txInput.getHash() === '94c7b6b7cc3e3a46890e9bfbbb9e3b4428889ba379900d9bb2c9f064070dafed') {
      return { tx2: txInput.getHash() };
    }

    const tx2 = await this.getTransactionByHash(txInput.getHash());

    const id = `${BC_SUPER_COLLIDER}.txblock.${txInput.getHash()}`;
    const key = this._blockByTxCache.has(id) ? this._blockByTxCache.get(id) : await this.get(id);
    if (!key) {
      this._logger.info(`cannot find block for ${txInput.getHash()}`);
    }
    const [blockchain, _, hash, height] = key.split('.');

    const scriptType = getScriptType(tx2.getOutputsList()[txInput.getIndex()].getOutputScript());
    return { scriptType, tx2, height, hash, index: txInput.getIndex() };
  }

  async getTxData(tx, utxos, stxos, blockHash) {

    if (tx) {
      tx.getOutputsList().map((output, index) => {
        const scriptType = getScriptType(output.getOutputScript());
        utxos[scriptType].push({ tx, index });
      });

      let arr = await Promise.all(tx.getInputsList().map(i => {
        return this.getTxFromInput(i.getOutPoint());
      }));
      if (blockHash === '88fbc8627a70f0767a997047f8c70a0859d826334d82b3507066875b244b9fc7' || blockHash === '28a0b2011dc915c42015713386ecc9cd1440bc30b563f10993b43e6ba1845e74') {
        arr = arr.filter(a => {
          return a.tx2 !== '4f296ca2410f5676aeae3fad19270bc69661f461a55f4e1ea94a64cb1c756f81' && a.tx2 !== '94c7b6b7cc3e3a46890e9bfbbb9e3b4428889ba379900d9bb2c9f064070dafed';
        });
      }
      arr.map(({ scriptType, tx2, hash, height, index }) => {
        stxos[scriptType].push({ tx: tx2, index, height, hash });
      });
    }
  }

  /**
   * Index trade's send/recieve data to be easily looked up to add marked txs
   * @param hash BcBlock
   * @param height
   * @param blockchain string
   */
  async updateTradeIndex(utxo, block, remove) {
    try {
      const { tx, index } = utxo;
      const txHash = tx.getHash();
      const script = toASM(Buffer.from(tx.getOutputsList()[index].getOutputScript()), 0x01);
      const { makerTxHash, makerTxOutputIndex } = parseTakerLockScript(script);
      const [originalScript, blockHeight, makerOutput] = await this.getInitialMakerOrder(script);
      const inputs = tx.getInputsList();

      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const outPoint = input.getOutPoint();
        if (outPoint.getHash() === makerTxHash && outPoint.getIndex() === makerTxOutputIndex) {
          const inputScript = input.getInputScript();
          let { receivesToAddress, receivesToChain, receivesUnit, sendsFromAddress, sendsFromChain, sendsUnit, base } = parseMakerLockScript(originalScript);
          const [makerSendsFrom, makerReceivesTo] = [sendsFromAddress, receivesToAddress];
          const taker = parseTakerUnlockScript(toASM(Buffer.from(inputScript), 0x01));
          const [takerSendsFrom, takerReceivesTo] = [taker.sendsFromAddress, taker.receivesToAddress];
          const numer = new _decimal.Decimal(internalToHuman(makerOutput.getValue(), NRG));
          const denom = new _decimal.Decimal(internalToHuman(tx.getOutputsList()[index].getValue(), NRG));
          const ratio = denom.div(numer);

          receivesUnit = new _decimal.Decimal(receivesUnit).mul(ratio).div(new _decimal.Decimal(base)).toString();
          sendsUnit = new _decimal.Decimal(sendsUnit).mul(ratio).div(new _decimal.Decimal(base)).toString();

          const makerKey = `${makerSendsFrom}.${takerReceivesTo}.${sendsFromChain}.${sendsUnit}`;
          const takerKey = `${takerSendsFrom}.${makerReceivesTo}.${receivesToChain}.${receivesUnit}`;
          const keys = [makerKey, takerKey];
          const type = ['maker', 'taker'];

          const val = new BN(makerOutput.getValue()).toString();

          for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            let hashes = await this.get(key);
            if (remove) {
              if (hashes) {
                const check = hashes.indexOf(`${txHash}.${index}.${block.getHeight()}.${val}.${type[i]}`);
                if (check > -1) {
                  hashes.splice(check, 1);
                  await this.put(key, hashes);
                }
              }
            } else {
              if (!hashes) {
                hashes = [`${txHash}.${index}.${block.getHeight()}.${val}.${type[i]}`];
                debugUTXO(`${key} = ${hashes}`);
                await this.put(key, hashes);
              } else if (hashes.indexOf(`${txHash}.${index}.${block.getHeight()}.${val}.${type[i]}`) === -1) {
                hashes.push(`${txHash}.${index}.${block.getHeight()}.${val}.${type[i]}`);
                debugUTXO(`${key} = ${hashes}`);
                await this.put(key, hashes);
              }
            }
          }
          break;
        }
      }
      return true;
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  async extractAddressesFromUtxos(scriptType, utxos) {
    let addresses = new Set();
    const utxoToAddresses = {};
    if (OL_FAST_SYNC) {
      return { utxoToAddresses, addresses: {} };
    }
    for (let _ref of utxos) {
      let { txHash, index, script } = _ref;

      script = toASM(Buffer.from(script), 0x01);
      let addr = new Set();
      if (scriptType == ScriptType.NRG_TRANSFER) {
        addr.add(script.split(' ')[1]);
      } else if (scriptType == ScriptType.MAKER_OUTPUT) {
        addr.add(parseMakerLockScript(script).doubleHashedBcAddress);
      } else if (scriptType == ScriptType.TAKER_OUTPUT) {
        const [originalScript, blockHeight, makerOutput] = await this.getInitialMakerOrder(script);
        addr.add(parseMakerLockScript(originalScript).doubleHashedBcAddress);
        addr.add(parseTakerLockScript(script).doubleHashedBcAddress);
      } else if (scriptType == ScriptType.TAKER_CALLBACK) {
        const [originalScript, blockHeight, makerOutput] = await this.getInitialMakerOrder(script);
        addr.add(parseMakerLockScript(originalScript).doubleHashedBcAddress);
      }
      addr = Array.from(addr);
      for (const a of addr) {
        addresses.add(a);
      }
      utxoToAddresses[`${txHash}.${index}`] = addr;
    }

    addresses = Array.from(addresses);
    const utxoIndexes = await Promise.all(addresses.map(a => {
      return this.getUtxoIndexesByAddress(scriptType, a, true);
    }));
    return { utxoToAddresses, addresses: zipObj(addresses, utxoIndexes) };
  }

  /**
   * Add unspent outpoint from tx output
   */
  async addUTXO(scriptType, utxos, block) {
    if (utxos.length === 0) return true;
    let length = await this.getUtxosLength(scriptType);
    let oldLength = await this.get(`utxo.${scriptType}.length.${block.getHash()}`);

    if (oldLength) {
      debugUTXODetail(`using oldLength ${oldLength} vs length ${length} for ${block.getHash()}:${block.getHeight()}`);
      length = oldLength;
    } else {
      await this.put(`utxo.${scriptType}.length.${block.getHash()}`, length);
    }

    let count = await this.getUtxosCount(scriptType);

    let { utxoToAddresses, addresses } = await this.extractAddressesFromUtxos(scriptType, utxos.map(({ index, tx }) => {
      return { txHash: tx.getHash(), index, script: tx.getOutputsList()[index].getOutputScript() };
    }));

    for (let i = 0; i < utxos.length; i++) {
      const { index, tx, hash, height } = utxos[i];

      //add key for marked transactions for this taker order
      if (scriptType === 'taker_output') await this.updateTradeIndex({ tx, index }, block, false);

      const utxo = this.buildUtxo(tx, index, block, hash, height);
      const utxoIndex = await this.get(`opunspent.${tx.getHash()}.${index}`);
      if (!utxoIndex) {
        await this.put(`utxo.${scriptType}.${length}`, utxo);
        await this.put(`opunspent.${tx.getHash()}.${index}`, length);
      } else {
        debugUTXO(`setting length to ${utxoIndex}`);
        length = utxoIndex;
      }
      if (!OL_FAST_SYNC) {
        for (let addr of utxoToAddresses[`${tx.getHash()}.${index}`]) {
          let arrIndex = addresses[addr].indexOf(length);
          if (arrIndex === -1) {
            addresses[addr].push(length);
          }
        }
      }

      length++;
      count++;
    }

    // update addr -> utxoIndexes
    if (!OL_FAST_SYNC) {
      let puts = [];
      for (const addr of Object.keys(addresses)) {
        puts.push([`${addr}.${scriptType}`, [...new Set(addresses[addr])]]);
        puts.push([`address.last.${addr}`, block.getHash()]);
      }
      await this.putBulk(puts);
    }

    await this.put(`utxo.${scriptType}.length`, length);
    await this.put(`utxo.${scriptType}.count`, count);
    debugUTXODetail(`utxo.${scriptType}.length is ${length}`);
    debugUTXODetail(`utxo.${scriptType}.count is ${count}`);

    return true;
  }

  /**
   * Add unspent outpoint from tx output
   */
  async delUTXO(scriptType, utxos, block) {
    if (utxos.length === 0) return true;
    let count = await this.getUtxosCount(scriptType);

    let { utxoToAddresses, addresses } = await this.extractAddressesFromUtxos(scriptType, utxos.map(({ index, tx }) => {
      return { txHash: tx.getHash(), index, script: tx.getOutputsList()[index].getOutputScript() };
    }));

    let dels = [];
    let nextDels = [];

    for (let i = 0; i < utxos.length; i++) {
      const { index, tx, hash, height } = utxos[i];

      //add key for marked transactions for this taker order
      if (scriptType === 'taker_output') await this.updateTradeIndex({ tx, index }, block, true);
      let utxoIndex = await this.get(`opunspent.${tx.getHash()}.${index}`);
      if (utxoIndex >= 0) {
        if (!OL_FAST_SYNC) {
          for (let addr of utxoToAddresses[`${tx.getHash()}.${index}`]) {
            let arr = addresses[addr];
            let arrIndex = arr.indexOf(utxoIndex);
            if (arrIndex !== -1) {
              arr.splice(arrIndex, 1);
              addresses[addr] = arr;
            }
          }
        }
        dels.push(`utxo.${scriptType}.${utxoIndex}`);
        debugSpending(`spending opunspent.${tx.getHash()}.${index}`);
        nextDels.push(`opunspent.${tx.getHash()}.${index}`); // txHash.txIndex -> index
        count = count - 1;
      } else {
        debugUTXODetail(`utxo not saved saved for ${tx.getHash()}.${index}`);
      }
    }

    // update addr -> utxoIndexes

    if (!OL_FAST_SYNC) {
      let puts = [];
      for (const addr of Object.keys(addresses)) {
        puts.push([`${addr}.${scriptType}`, [...new Set(addresses[addr])]]);
        puts.push([`address.last.${addr}`, block.getHash()]);
      }
      await this.putBulk(puts);
    }

    await this.put(`utxo.${scriptType}.count`, count);
    await this.delBulk(dels);
    await this.delBulk(nextDels);

    debugUTXODetail(`utxo.${scriptType}.count is ${count}`);

    return true;
  }

  async getUtxoIndexesByAddress(scriptType, address, hashed) {
    if (!hashed) address = '0x' + blake2bl(blake2bl(address.toLowerCase()) + address.toLowerCase());
    const indexes = await this.get(`${address}.${scriptType}`);
    return indexes ? indexes : [];
  }

  async getUtxos(scriptType, opts = { from: null, to: null, address: false }) {

    //debugReadOperations(`getUtxos()`)
    //if (!this._readEventTable['getUtxos']) {
    //  this._readEventTable['getUtxos'] = 0
    //}
    //this._readEventTable['getUtxos']++

    let keys = [];
    if (opts.address) {
      keys = await this.getUtxoIndexesByAddress(scriptType, opts.address);
      keys = keys.map(i => {
        return `utxo.${scriptType}.${i}`;
      });
    } else {
      const length = await this.getUtxosLength(scriptType);
      const from = opts.from ? opts.from : 0;
      const to = opts.to ? opts.to : length;

      for (let i = from; i < to; i++) {
        keys.push(`utxo.${scriptType}.${i}`);
      }
    }
    let utxos = await this.getBulk(keys);
    utxos = utxos.filter(u => {
      return u != null;
    });
    return { utxos, scriptType };
  }

  buildUtxo(tx, index, block, hash, height) {
    const arr = [tx.getOutputsList()[index].toObject(), tx.getHash(), index, hash || block.getHash(), height || block.getHeight(), tx.getInputsList().length == 0];
    const utxo = new Utxo(arr);
    utxo.setOutput(tx.getOutputsList()[index]);
    return utxo;
  }

  async getUtxosCount(scriptType, address) {
    if (address === null || address === undefined || address === '') {
      let length = await this.get(`utxo.${scriptType}.count`);
      if (!length) length = await this.get(`utxo.${scriptType}.length`);
      return length || 0;
    } else {
      address = '0x' + blake2bl(blake2bl(address.toLowerCase()) + address.toLowerCase());
      const indexes = await this.get(`${address}.${scriptType}`);
      return indexes ? indexes.length : 0;
    }
  }

  async getUtxosLength(scriptType, address) {
    if (address === null || address === undefined || address === '') {
      let length = await this.get(`utxo.${scriptType}.length`);
      return length || 0;
    } else {
      address = '0x' + blake2bl(blake2bl(address.toLowerCase()) + address.toLowerCase());
      const indexes = await this.get(`${address}.${scriptType}`);
      return indexes ? indexes.length : 0;
    }
  }
  async viewUTXOs() {
    debugUTXO("calling cleanup");
    let date = Date.now();
    //save each utxo for each script type
    const utxos = { nrg_transfer: [], maker_output: [], taker_output: [], taker_callback: [] };
    for (let i = 0; i < Object.keys(utxos).length; i++) {
      let keys = [];
      let scriptType = Object.keys(utxos)[i];
      const length = await this.getUtxosLength(scriptType);
      let count = await this.getUtxosCount(scriptType);

      let nullIndexes = [];
      let fullIndexes = [];
      let notFound = [];
      //collect all null and full indexes
      for (let j = 0; j < length; j++) {
        let utxo = await this.get(`utxo.${scriptType}.${j}`);
        if (!utxo) nullIndexes.push(j);else {
          fullIndexes.push({ index: j, utxo });
          let tx = await this.getTransactionByHash(utxo.getTxHash());
          if (!tx) {
            notFound.push({ index: j, utxo });
          }
        }
      }

      let { utxoToAddresses, addresses } = await this.extractAddressesFromUtxos(scriptType, notFound.map(({ utxo }) => {
        return { txHash: utxo.getTxHash(), index: utxo.getTxIndex(), script: utxo.getOutput().getOutputScript() };
      }));

      //replace the null indexes with full indexes if null Index < fullIndex
      for (let j = 0; j < notFound.length; j++) {
        let { utxo, index } = notFound[j];
        let txHash = utxo.getTxHash();
        let txIndex = utxo.getTxIndex();

        for (let addr of utxoToAddresses[`${txHash}.${txIndex}`]) {
          let arr = addresses[addr];
          let arrIndex = arr.indexOf(index);
          if (arrIndex !== -1) {
            arr.splice(arrIndex, 1);
            addresses[addr] = arr;
          }
        }
        count--;
        await this.del(`utxo.${scriptType}.${index}`);
        await this.del(`opunspent.${tx.getHash()}.${txIndex}`); // txHash.txIndex -> index
      }

      await this.put(`utxo.${scriptType}.count`, count);

      for (const addr of Object.keys(addresses)) {
        puts.push([`${addr}.${scriptType}`, [...new Set(addresses[addr])]]);
      }

      await this.putBulk(puts);
    }
    debugUTXO(`clean up took ${Date.now() - date} ms`);
  }

  async cleanUpUTXOs() {
    debugUTXO("calling cleanup");
    let date = Date.now();
    //save each utxo for each script type
    const utxos = { maker_output: [], taker_output: [], taker_callback: [] };
    for (let i = 0; i < Object.keys(utxos).length; i++) {
      let keys = [];
      let scriptType = Object.keys(utxos)[i];
      const length = await this.getUtxosLength(scriptType);
      const count = await this.getUtxosCount(scriptType);

      let nullIndexes = [];
      let fullIndexes = [];
      //collect all null and full indexes
      for (let j = 0; j < length; j++) {
        let utxo = await this.get(`utxo.${scriptType}.${j}`);
        if (!utxo) nullIndexes.push(j);else fullIndexes.push({ index: j, utxo });
      }

      let { utxoToAddresses, addresses } = await this.extractAddressesFromUtxos(scriptType, fullIndexes.map(({ utxo }) => {
        return { txHash: utxo.getTxHash(), index: utxo.getTxIndex(), script: utxo.getOutput().getOutputScript() };
      }));
      //replace the null indexes with full indexes if null Index < fullIndex
      for (let j = 0; j < fullIndexes.length; j++) {
        let { utxo, index } = fullIndexes[j];
        let txHash = utxo.getTxHash();
        let txIndex = utxo.getTxIndex();

        for (let addr of utxoToAddresses[`${txHash}.${txIndex}`]) {
          let arrIndex = addresses[addr].indexOf(index);
          addresses[addr][arrIndex] = j;
        }
        debugUTXO(`putting opunspent.${txHash}.${txIndex} at ${j}`);
        debugUTXO(`putting utxo.${scriptType}.${j} at ${utxo}`);
        await this.put(`opunspent.${txHash}.${txIndex}`, j);
        await this.put(`utxo.${scriptType}.${j}`, utxo);
      }

      let puts = [];
      for (const addr of Object.keys(addresses)) {
        puts.push([`${addr}.${scriptType}`, [...new Set(addresses[addr])]]);
      }
      await this.putBulk(puts);
      await this.put(`utxo.${scriptType}.length`, fullIndexes.length);

      debugUTXO({ null: nullIndexes.length, full: fullIndexes.length, length, count });
    }
    debugUTXO(`clean up took ${Date.now() - date} ms`);
  }

  async saveBlockHeaders(block) {
    if (!block || block && !block.getBlockchainHeaders) return;
    //ensure child blocks are saved
    const headersMap = block.getBlockchainHeaders();
    let children = [];
    let methodNames = Object.keys(headersMap.toObject());
    for (let i = 0; i < methodNames.length; i++) {
      let rover = methodNames[i];
      const getMethodName = `get${rover[0].toUpperCase()}${rover.slice(1)}`;
      const childBlocks = headersMap[getMethodName]();
      children = concat(children, childBlocks);
    }
    for (let i = 0; i < children.length; i++) {
      let child = children[i];
      let hashSaved = await this.get(`${child.getBlockchain()}.block.${child.getHash()}`);
      if (!hashSaved) {
        await this.put(`${child.getBlockchain()}.block.${child.getHash()}`, child);
      }
      await this.putBlockHashAtHeight(child.getHash(), child.getHeight(), child.getBlockchain());
      let heightSaved = await this.get(`${child.getBlockchain()}.block.${child.getHeight()}`);
      if (!heightSaved) {
        await this.put(`${child.getBlockchain()}.block.${child.getHeight()}`, child);
      }
    }
    return;
  }

  async saveBlock(block) {
    // let latest = await this.get(`bc.block.latest`)
    // if(latest && block.getHeight() > latest.getHeight()) {
    // debugUTXODetail(`updating latest block to ${block.getHeight()}`)
    // await this.put(`bc.block.latest`, block)
    // }
    this._blockByHashCache.set(`${BC_SUPER_COLLIDER}.block.${block.getHash()}`, block);
    await this.put(`bc.block.${block.getHeight()}`, block); // this overrides the height
    await this.put(`bc.block.${block.getHash()}`, block); // ensure block gets saved at height
    await this.putBlockHashAtHeight(block.getHash(), block.getHeight(), 'bc');
    await this.saveTxsForBlock(block);
    await this.saveBlockHeaders(block);
    if (block.getHeight() % 100 === 0) await this.saveLast100(block);
    if (parseInt(block.getHeight(), 10) % 100000 === 0) await this.cleanUpUTXOs();
    return;
  }

  async getLastTakerBlockHeight() {
    const lastBlock = await this.get('bc.block.lastTaker');
    return lastBlock;
  }

  async getNextTakerBlock(height) {
    const nextHeight = await this.get(`bc.block.taker.${height}`);
    return nextHeight;
  }

  async getTradeIndices(sendsFromAddress, receivesToAddress, sendsFromChain, sendsUnit) {
    const key = `${sendsFromAddress}.${receivesToAddress}.${sendsFromChain}.${sendsUnit}`;

    //debugReadOperations(`getTradeIndices() ${key}`)
    //if (!this._readEventTable['getTradeIndices']) {
    //  this._readEventTable['getTradeIndices'] = 0
    //}
    //this._readEventTable['getTradeIndices']++

    // this._logger.info(`searching for ${key}`)
    const hashes = await this.get(key);
    // this._logger.info(hashes)
    return hashes;
  }

  /**
   * Check if an outpoint is unspent
   * @param txHash string
   * @param index number
   * @param blockchain string
   */
  async isOutPointUnspent(txHash, index) {
    const key = `opunspent.${txHash}.${index}`;
    try {
      const isUnspent = await this.get(key);
      return isUnspent != null && isUnspent >= 0;
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  async getTxClaimedBy(hash, index, blockchain = 'bc') {
    const key = `opspent.${hash}.${index}`;

    //debugReadOperations(`getTxClaimedBy() ${key}`)
    //if (!this._readEventTable['getTxClaimedBy']) {
    //  this._readEventTable['getTxClaimedBy'] = 0
    //}
    //this._readEventTable['getTxClaimedBy']++

    const val = await this.get(key);
    if (val) {
      return await this.getTransactionByHash(val.split('.')[1]);
    } else return new Transaction();
  }

  async getRootBlockFromBranch(blockFirst, blockSecond, opts = { asHeight: false, asBuffer: true, chainState: false }) {
    let blockA;
    let blockB;
    // sort so that BlockA is always the lower height than blockB
    if (blockFirst.getHeight() > blockSecond.getHeight()) {
      blockB = blockFirst;
      blockA = blockSecond;
    } else {
      blockA = blockFirst;
      blockB = blockSecond;
    }
    const blockchain = blockA.getBlockchain ? blockA.getBlockchain() : 'bc';
    // if they are not the same height already find the block that is
    if (blockA.getHeight() !== blockB.getHeight()) {
      blockB = await this.getLowerBlockAtHeightFromBlock(blockA.getHeight(), blockB);
    }
    let root = false;
    // if blockB at the same height as block by in sequence could not be found end the function
    if (!blockB) {
      return Promise.resolve(root);
    }
    let prevBlockHeight = blockA.getHeight();
    let prevBlockAHash = blockA.getPreviousHash();
    let prevBlockBHash = blockB.getPreviousHash();
    this._logger.info(`getRootBlockFromBranch(): ${prevBlockHeight} prevBlockAHash: ${prevBlockAHash} prevBlockBHash: ${prevBlockBHash}`);
    while (typeof root === 'boolean' && !root) {
      if (prevBlockAHash && prevBlockAHash === prevBlockBHash) {
        root = await this.getBlockByHash(prevBlockAHash, blockchain);
        break;
      } else {
        // !!!!! DONT ADD AWAIT TO THESE YET
        const blockAParent = await this.getBlockByHash(prevBlockAHash, blockchain, { asHeader: true });
        const blockBParent = await this.getBlockByHash(prevBlockBHash, blockchain, { asHeader: true });
        // const blockAParent = await this.getBlockByHash(prevBlockAHash, blockchain, { asHeader: true })
        // const blockBParent = await this.getBlockByHash(prevBlockBHash, blockchain, { asHeader: true })
        // either blockAParent OR (||) blockBParent is missing
        if (!blockAParent || !blockBParent) {
          // blockAParent AND (&&) blockBParent are missing
          if (!blockAParent && !blockBParent) {
            root = prevBlockHeight;
            break;
          } else {
            root = !blockBParent ? blockAParent.getHeight() : blockBParent.getHeight();
            break;
          }
        } else if (blockAParent.getPreviousHash && blockBParent.getPreviousHash) {
          prevBlockAHash = blockAParent.getPreviousHash();
          prevBlockBHash = blockBParent.getPreviousHash();
          prevBlockHeight = blockAParent.getHeight();
          // DEBUG
          this._logger.info(`getRootBlockFromBranch(): prevBlockHeight: ${prevBlockHeight} prevBlockAHash: ${prevBlockAHash} prevBlockBHash: ${prevBlockBHash}`);
          if (prevBlockBHash === prevBlockAHash) {
            root = blockAParent;
            break;
          }
        } else {
          root = prevBlockHeight;
          break;
        }
      }
    }
    return Promise.resolve(root);
  }

  /**
   * Iterate through blocks from decreasing height confirm the sequence exists and return null or return first missing block
   * @param blockchain string
   * @param block BcBlock|Block
   * @param blocksToConfirm number
   * @param opts object
   */
  async getMissingBlockFromBlock(blockchain = 'bc', block, blocksToConfirm = 1000, opts = { asBuffer: true }) {
    if (!height || isNaN(height)) {
      return Promise.reject(new Error('must provide start height as number'));
    }

    //debugReadOperations(`getMissingBlockFromBlock() ${blockchain} ${block.getHeight()}:${block.getHash()}`)
    //if (!this._readEventTable['getMissingBlockFromBlock']) {
    //  this._readEventTable['getMissingBlockFromBlock'] = 0
    //}
    //this._readEventTable['getMissingBlockFromBlock']++

    let missingBlock = null;
    let prevHash = block.getPreviousHash();
    let processedBlocks = 0;

    if (parseInt(block.getHeight(), 10) < 3) {
      return Promise.resolve(missingBlock);
    }

    if (parseInt(block.getHeight(), 10) < blocksToConfirm) {
      blocksToConfirm = parseInt(block.getHeight(), 10) - 1;
    }

    do {
      if (missingBlock) {
        break;
      }

      processedBlocks++;
      blocksToConfirm--;

      let nextBlock = null;
      const key = `${blockchain}.block.${prevHash}`;
      if (this._blockByHashCache.has(key)) {
        nextBlock = this._blockByHashCache.get(key);
      } else {
        nextBlock = await this.get(key);
      }

      if (!nextBlock || !nextBlock.getPreviousHash) {
        missingBlock = {
          hash: prevHash,
          height: parseInt(block.getHeight(), 10) - processedBlocks
        };
      }

      prevHash = nextBlock.getPreviousHash();
    } while (blocksToConfirm > 0);

    return Promise.resolve(missingBlock);
  }

  async getLowerBlockAtHeightFromBlock(height, block, opts = { asHeight: false, asBuffer: true, chainState: false }) {
    const blockchain = block.getBlockchain ? block.getBlockchain() : 'bc';
    let h = false;
    let lastHash = block.getPreviousHash();
    let result = false;

    //debugReadOperations(`getLowerBlockAtHeightFromBlock() ${height} <- ${blockchain} ${block.getHeight()}:${block.getHash()}`)
    //if (!this._readEventTable['getLowerBlockAtHeightFromBlock']) {
    //  this._readEventTable['getLowerBlockAtHeightFromBlock'] = 0
    //}
    //this._readEventTable['getLowerBlockAtHeightFromBlock']++

    while (h !== height) {
      const parentBlock = await this.getBlockByHash(lastHash, blockchain, { asHeader: true });
      if (!parentBlock) {
        h = height;
      } else if (parentBlock.getHeight() === height) {
        h = height;
        result = parentBlock;
        break;
      } else {
        lastHash = parentBlock.getPreviousHash();
      }
    }

    return result;
  }

  /**
   * Validates the rovered blocks matches blocks provided by the block returning true (yes) false (no)
   * @param block BcBlock||Block
   */
  async putBlockPassesRoverTest(block, opts = { asBuffer: true }) {

    if (block && !block.getBlockchain) {
      const watchlist = {};
      const rovers = [];
      const headersMap = block.getBlockchainHeaders();
      const headerHashes = [];
      let headers = Object.keys(headersMap.toObject()).reduce((all, listName) => {
        rovers.push(listName);
        const getMethodName = `get${listName[0].toUpperCase()}${listName.slice(1)}`;
        const chainHeaders = headersMap[getMethodName]();
        return all.concat(sortBlocks(chainHeaders));
      }, []);

      const headerTable = headers.reduce((all, h) => {
        if (h && h.getHash) {
          all[h.getHash()] = h;
        }
        return all;
      }, {});

      for (let h of headers) {
        const roveredHeaderMerkle = await this.get(`${h.getBlockchain()}.rovered.${h.getHash()}`);
        if (roveredHeaderMerkle) {
          const purposedMerkle = getMarkedTransactionsMerkle(h);
          if (roveredHeaderMerkle !== purposedMerkle) {
            const currentLatest = await this.get(`${BC_SUPER_COLLIDER}.block.latest`);

            if (parseInt(currentLatest.getHeight(), 10) < parseInt(block.getHeight(), 10) + 1000 && parseInt(block.getHeight(), 10) !== 3221044) {
              this._logger.warn(`rover found malformed child ${h.getBlockchain()} in proposed ${BC_SUPER_COLLIDER} ${block.getHeight()}...`);
              this._logger.warn(`purposed: ${purposedMerkle} !== rovered: ${roveredHeaderMerkle}`);
              return false;
            } else {
              this._logger.info(`local block ${parseInt(block.getHeight(), 10)} mount is after stale threshold latest: ${parseInt(currentLatest.getHeight(), 10)}`);
            }
          }
        }
      }

      for (let r of rovers) {
        const queryRaised = await this.get(`${r}.query`);
        if (queryRaised) {
          const blockHash = queryRaised.split(":")[0];
          const roveredMerkle = queryRaised.split(":")[1];

          if (headerTable[blockHash] !== undefined) {
            const purposedMerkle = getMarkedTransactionsMerkle(headerTable[blockHash]);
            if (purposedMerkle === roveredMerkle) {
              // query resolved
              this._logger.info(`${r} query resolved ${blockHash.slice(0, 21)}`);
              await this.del(`${r}.query`);
            } else {
              this._logger.warn(`rover discovered miss matching child ${r} in local block ...`);
              return false;
            }
          }
        }
      }
      return true;
    } else {
      this._logger.warn(`putBlockPassesRoverTest(): function is only for super collider blocks: ${BC_SUPER_COLLIDER}`);
      return true;
    }
  }

  /**
   * Put block by it's hash and chain id. Also stores transactions if possible
   * @param block BcBlock||Block
   * @param blockchain string
   */
  async putBlock(block, branch = 0, blockchain = 'bc', opts = {
    asBuffer: true,
    fromWaypoint: false,
    saveHeaders: false,
    force: false,
    storeOnlyOne: false,
    updateHeight: true,
    rovered: false
  }) {
    // try {
    // clone the _block to avoid modifying the referenced object
    //
    //debugWriteOperations(`putBlock() ${blockchain} ${block.getHeight()} : ${block.getHash()}`)
    //if (!this._writeEventTable['putBlock']) {
    //  this._writeEventTable['putBlock'] = 0
    //}
    //this._writeEventTable['putBlock']++
    //
    let now = Date.now();
    const pass = opts.force;
    let cachedBlock = false;
    // if its a ol block store headers
    let headers = [];
    if (!block) {
      throw new Error('malformed block');
    }

    if (this._blockByHeightCache.has(`${blockchain}.block.${parseInt(block.getHeight(), 10)}`) && !opts.rovered) {
      cachedBlock = this._blockByHeightCache.get(`${blockchain}.block.${parseInt(block.getHeight(), 10)}`);
    }

    if (cachedBlock) {
      if (!cachedBlock.getHash) {
        this._blockByHeightCache.del(`${blockchain}.block.${parseInt(block.getHeight(), 10)}`);
      }
    }

    const key = `${blockchain}.block.${block.getHash()}`;
    const markedTxMerkle = getMarkedTransactionsMerkle(block);

    if (opts.rovered) {
      debug(`rover marked id ${markedTxMerkle} for ${blockchain} #${block.getHash()}`);
      await this.put(`${blockchain}.rovered.${block.getHash()}`, markedTxMerkle);
    }

    await this.putBlockHashAtHeight(block.getHash(), block.getHeight(), blockchain, { storeOnlyOne: opts.storeOnlyOne });
    await this.saveTxsForBlock(block);

    if (blockchain === BC_SUPER_COLLIDER) {

      const watchlist = {};
      const rovers = [];
      const headersMap = block.getBlockchainHeaders();
      const headerHashes = [];
      headers = Object.keys(headersMap.toObject()).reduce((all, listName) => {
        rovers.push(listName);
        const getMethodName = `get${listName[0].toUpperCase()}${listName.slice(1)}`;
        const chainHeaders = headersMap[getMethodName]();
        return all.concat(sortBlocks(chainHeaders));
      }, []);

      const headerTable = headers.reduce((all, h) => {
        if (h && h.getHash) {
          all[h.getHash()] = h;
        }
        return all;
      }, {});

      for (let i = 0; i < headers.length; i++) {
        let h = headers[i];
        const roveredHeaderMerkle = await this.get(`${h.getBlockchain()}.rovered.${h.getHash()}`);
        if (roveredHeaderMerkle && parseInt(block.getHeight(), 10) !== 3221044) {
          const purposedMerkle = getMarkedTransactionsMerkle(h);
          if (roveredHeaderMerkle !== purposedMerkle) {
            if (parseInt(block.getTimestamp(), 10) - 3101 < now) {

              const b = await this.getBlockByHeight(block.getHeight(), blockchain);
              if (!b || b && b.getHash() === block.getHash()) {
                this._logger.warn(`overriding stale node connection state`);
                await this.del(`${h.getBlockchain()}.rovered.${h.getHash()}`);
              } else {
                if (parseInt(block.getHeight(), 10) > 3236762) {
                  this._logger.warn(`rover confirmed malformed child ${h.getBlockchain()} in proposed ${BC_SUPER_COLLIDER} ${block.getHeight()}...`);
                  this._logger.warn(`purposed: ${purposedMerkle} !== rovered: ${roveredHeaderMerkle}`);
                  return false;
                }
              }
            } else {
              this._logger.warn(`rover found malformed child ${h.getBlockchain()} in proposed ${BC_SUPER_COLLIDER} ${block.getHeight()}...`);
              this._logger.warn(`purposed: ${purposedMerkle} !== rovered: ${roveredHeaderMerkle}`);
              return false;
            }
          }
        }
      }

      for (let i = 0; i < rovers.length; i++) {
        let r = rovers[i];
        const queryRaised = await this.get(`${r}.query`);
        if (queryRaised) {
          const blockHash = queryRaised.split(":")[0];
          const roveredMerkle = queryRaised.split(":")[1];

          if (headerTable[blockHash] !== undefined) {
            const purposedMerkle = getMarkedTransactionsMerkle(headerTable[blockHash]);
            if (purposedMerkle === roveredMerkle) {
              // query resolved
              this._logger.info(`${r} query resolved ${blockHash.slice(0, 21)}`);
              await this.del(`${r}.query`);
            } else {
              this._logger.warn(`rover discovered miss matching child ${r} in local block ...`);
              return false;
            }
          }
        }
      }
    }

    debug(`putBlock(): storing ${blockchain}.block.${block.getHash()}`);

    // store txs
    const txs = block.getTxsList !== undefined ? block.getTxsList() : block.getMarkedTxsList();
    if (txs.length > 0) await this.putTransactionBlockIndex(txs.map(tx => {
      return tx.getHash();
    }), block.getHash(), block.getHeight(), branch, blockchain);
    debug(`would store ${blockchain} ${txs.length} from block ${block.getHeight()}`);

    if (block.getBlockchain !== undefined && blockchain === 'bc') {
      blockchain = block.getBlockchain();
    }

    for (let i = 0; i < txs.length; i++) {
      let tx = txs[i];
      await this.putTransaction(tx, block.getHash(), branch, blockchain);
    }

    if (block.getHash === undefined) {
      this._logger.error(new Error('putBlock(): malformed block submission without hash'));
      return [];
    }

    // existingBlock = false
    // if the blockchain is a rovered block allow it to be stored
    const newBlocks = block.getBlockchainHeadersCount ? parseInt(block.getBlockchainHeadersCount(), 10) : 0;
    if (newBlocks > 228) {
      this._logger.warn(`new block has more than threshold 228 headers (${newBlocks})`);
    }

    debugPutBlock(`checking block by hash`);
    const existingBlock = await this.get(`${blockchain}.block.${block.getHash()}`);
    if (existingBlock && !pass && parseInt(block.getHeight(), 10) > 3236762) {
      if (opts.rovered && parseInt(block.getHeight(), 10) !== 3221044) {
        debugPutBlock(`checking block merkle transactions`);
        const preMerkleRoot = getMarkedTransactionsMerkle(existingBlock);
        if (preMerkleRoot !== markedTxMerkle) {
          if (parseInt(block.getTimestamp(), 10) - 3101 < now) {
            // store the correct block in place
            const altb = await this.getBlockByHeight(block.getHeight(), blockchain);
            if (altb && altb.getHash() !== block.getHash()) {
              await this.put(`${blockchain}.block.${block.getHash()}`, block);
              this._logger.warn(`${blockchain} rover discovered malformed block ${block.getHeight()} : ${block.getHash().slice(0, 21)}`);
              await this.put(`${blockchain}.query`, `${block.getHash()}:${markedTxMerkle}`);
              return Promise.resolve({ purgeBlocksTo: block.getPreviousHash() });
            }
          } else {
            await this.put(`${blockchain}.block.${block.getHash()}`, block);
            this._logger.warn(`${blockchain} rover discovered malformed block ${block.getHeight()} : ${block.getHash().slice(0, 21)}`);
            await this.put(`${blockchain}.query`, `${block.getHash()}:${markedTxMerkle}`);
            return Promise.resolve({ purgeBlocksTo: block.getPreviousHash() });
          }
        }
      }
      debug(`putBlock(): ${blockchain} block ${block.getHeight()} already exists as hash`);
      if (block.getTxsList !== undefined && block.getBlockchainHeaders) {
        debugPutBlock(`putting child blocks index`);
        await this.putChildBlocksIndexFromBlock(block);
      }
      return false;
    } else {
      debugPutBlock(`putting block hash at height`);
      // if its an overline block also store indexes
      await this.put(`${blockchain}.block.${block.getHash()}`, block);
      if (block.getTxsList !== undefined && block.getBlockchainHeaders) {
        debugPutBlock(`putting block index child `);
        await this.putChildBlocksIndexFromBlock(block);
      }
      debug(`putBlock(): storing ${blockchain} block ${block.getHeight()} : ${block.getHash()} as new block`);
    }

    const childBlockSaved = block.getMarkedTxsList ? false : this._blockSavedCache.has(`${blockchain}.block.${block.getHash()}`);

    if (block && !block.getMarkedTxsList && block.getHash) {
      this._blockSavedCache.set(`${blockchain}.block.${block.getHash()}`, 1);
    }

    // store block WITH txs in cache
    if (block && block.getHash) {
      this._blockByHashCache.set(key, block);
    }

    if (opts.updateHeight && block && block.getHash) {
      this._blockByHeightCache.set(`${blockchain}.block.${parseInt(block.getHeight(), 10)}`, block);
      await this.put(`${blockchain}.block.${block.getHeight()}`, block); // this overrides the height
    } else if (block && block.getHash && !this._blockByHeightCache.has(`${blockchain}.block.${parseInt(block.getHeight(), 10)}`)) {
      this._blockByHeightCache.set(`${blockchain}.block.${parseInt(block.getHeight(), 10)}`, block);
    }

    const externalOps = [];
    debug(`storing txs ${txs.length} for block ${block.getHeight()}`);

    // is BC block, hence store underlying blocks
    if (block.getTxsList !== undefined) {
      debugPutBlock(`updating block ${block.getHeight()}`);
      // await this.updateMarkedBalances(block, blockchain) // update the marked address balances

      if (opts.saveHeaders) {
        debugPutBlock(`updating block headers ${block.getHeight()}`);
        for (const header of headers) {
          await this.putBlock(header, 0, header.getBlockchain());
        }
      }
      // DEBUG
    }

    debugPutBlock(`returning putBlock from ${block.getHeight()}.${block.getHash()} took ${Date.now() - now}ms`);
    return externalOps;
  }

  /**
   * Whenever a BcBlock is deleted reset marked transactions table to the most recent mod 3000 block height
   * @param block BcBlock
   */
  async resetMarkedBalancesFromBlock(block, blockchain = 'bc', opts = { asBuffer: true }) {
    const mod = new BN(block.getHeight()).mod(new BN(3000));
    // delete the snap shot as well if mod 3000 === 0
    if (new BN(0).eq(mod) === true) {
      await this.del(`${blockchain}.marked.latest.snapshot`);
      await this.del(`${blockchain}.marked.balances.snapshot`);
      await this.del(`${blockchain}.marked.latest`);
      await this.del(`${blockchain}.marked.balances`);
      return true;
      // if there are less than 3000 blocks there is no marked transaction to reset
    } else if (new BN(block.getHeight()).lt(new BN(3000))) {
      return true;
    } else {
      const latestSnapshot = await this.get(`${blockchain}.marked.latest.snapshot`);
      const balancesSnapshot = await this.get(`${blockchain}.marked.balances.snapshot`);
      await this.put(`${blockchain}.marked.latest`, latestSnapshot);
      await this.put(`${blockchain}.marked.balances`, balancesSnapshot);
      return true;
    }
  }

  /**
   * Gets the balance of a marked token from a given chain
   * @param address string
   * @param tokenAddress string
   * @param connectedChain string the connected chain for Emblems is Ethereum
   * @param blockchain string
   */
  async getMarkedBalanceData(address, tokenAddress = EMBLEM_CONTRACT_ADDRESS, connectedChain = 'eth', blockchain = 'bc', opts = { asBuffer: true }) {

    //debugReadOperations(`getMarkedBalanceData() ${address} <- ${tokenAddress}`)
    //if (!this._readEventTable['getMarkedBalanceData']) {
    //  this._readEventTable['getMarkedBalanceData'] = 0
    //}
    //this._readEventTable['getMarkedBalanceData']++

    try {

      const edge = await this.get(`${blockchain}.sync.edge`);
      if (edge && new BN(edge).lte(new BN(3208880)) && !BC_MARKED_DRY_RUN) {
        return new BN(0);
      }

      if (BC_MARKED_DRY_RUN) {
        this._logger.warn(`BC_MARKED_DRY_RUN is enabled and should not be used when mining`);
      }

      let tokenType = 'emb';

      const balance = await this.get(`${connectedChain}.${tokenType}.${tokenAddress}.${address}.credit`);
      debugEMBBalance(`balance for ${address} is ${balance}`);

      if (!balance) {
        return new BN(0);
      }

      if (balance && balance.indexOf(':') < 0) {
        return new BN(0);
      }

      const balanceAmount = parseInt(balance.split(':')[0], 10) / Math.pow(10, 8);
      return balanceAmount;
    } catch (e) {
      console.trace(e);
      return new BN(0);
    }
  }

  /**
   * Run any operations scheduled at block height and delete
   * @param height {number} block height
   * @param blockchain {string} value of data
   */
  async runScheduledOperations(height, blockchain = 'bc', opts = { asBuffer: true }) {
    const scheduledOperations = await this.get(`${blockchain}.schedule.${height}`);
    if (!scheduledOperations || !Array.isArray(scheduledOperations)) {
      return [];
    }

    // delete these
    // 93280 'lsk' extendMultichain blockhash

    const externalOps = [];
    for (const op of scheduledOperations) {
      debug(`runScheduledOperations(): ${op}`);
      if (op.length >= 4) {
        const operation = op[1];
        if (EXTERNAL_OPERATIONS.indexOf(operation) > -1) {
          externalOps.push(op);
          continue;
        }
        const key = op[2];
        // if the operation has a value
        if (op.length === 5) {
          const value = op[3];
          // check if the operation is a delfromlist
          if (operation !== 'delfromlist') {
            await this[operation](key, value);
          } else {
            const data = await this.get(key);
            const update = data.reduce((all, d) => {
              if (!equals(d, value)) {
                all.push(d);
              }
              return all;
            }, []);
            if (update.length === 0) {
              await this.del(key);
            } else {
              await this.put(key, update);
            }
          }
        } else {
          await this[operation](key);
        }
      }
    }
    if (opts.removeSchedule) {
      await this.del(`${blockchain}.schedule.${height}`);
    }
    return externalOps;
  }

  /**
   * Adds simple database operation to be conducted at a block height
   * @param height {number} block height
   * @param operation {string} type of operation get, put, del
   * @param key {string} key of data
   * @param value {string} value of data
   * @param blockchain {string} value of data
   */
  async scheduleAtBlockHeight(height, operation, key, value = '', blockchain = 'bc', opts = { asBuffer: true }) {
    const refKey = `${blockchain}.schedule.${height}`;
    let scheduledOperations = await this.get(refKey);
    if (!scheduledOperations || !Array.isArray(scheduledOperations)) {
      scheduledOperations = [];
    }
    // check if the given operation is supported
    if (!contains(operation, SUPPORTED_SCHEDULED_OPERATIONS)) {
      return false;
    }
    let eventArgs = [height, operation, key, value, blockchain];
    // if the value is empty or default do not store in the schedule
    if (value === '') {
      eventArgs = [height, operation, key, blockchain];
    }
    // FIXME cannot join nonstring values (what if I store e.g. array as a value?)
    const uniqueKey = blake2bl(eventArgs.join(''));
    const restrictedSet = scheduledOperations.map(s => {
      return blake2bl(s.join(''));
    });
    if (restrictedSet.indexOf(uniqueKey) > -1) {
      return true;
    }
    scheduledOperations.push(eventArgs);
    await this.put(refKey, scheduledOperations);

    return true;
  }

  /**
   * Updates the table of balances for all marked transactions from connected chains
   * @param block BcBlock
   * @param blockchain string
   */
  async updateMarkedBalances(block, blockchain = 'bc', opts = { asBuffer: true }) {
    const providedBlockHeight = block.getHeight();
    let currentBlockIndex = 1;
    let balances = {};
    // checks bc.marked.latest and bc.marked.balances keys in rocksdb
    // look up the last block indexed with  marked transactions in context of given blockchain
    const latestMarkedBlock = await this.get(`${blockchain}.marked.latest`);
    if (block !== null && block.getBlockchainHeaders !== undefined) {
      const headersMap = block.getBlockchainHeaders();
      if (!latestMarkedBlock) {
        // if no marked transaction scan has been run set height to the provided block
        for (const listName of Object.keys(headersMap.toObject())) {
          balances[listName.slice(0, 3)] = {};
        }
      } else if (new BN(providedBlockHeight).eq(latestMarkedBlock.getHeight())) {
        // already added marked balances for this block
        balances = await this.get(`${blockchain}.marked.balances`);
        return JSON.parse(balances); // FIXME introduce new protobuf message for this
      } else {
        currentBlockIndex = latestMarkedBlock.getHeight();
        balances = JSON.parse((await this.get(`${blockchain}.marked.balances`)));
        if (!balances) {
          balances = {};
          // if this occurs marked database is corrupt reset
          currentBlockIndex = 1;
          for (const listName of Object.keys(headersMap.toObject())) {
            balances[listName.slice(0, 3)] = {};
          }
        }
      }

      for (let i = currentBlockIndex; i <= providedBlockHeight; i++) {
        try {
          const blockFrame = await this.get(`${blockchain}.block.${i}`);
          if (blockFrame === null || blockFrame.getBlockchainHeaders === undefined) {
            continue;
          }
          const frameHeaders = blockFrame.getBlockchainHeaders();
          Object.keys(frameHeaders.toObject()).map(listName => {
            const method = `get${listName[0].toUpperCase()}${listName.slice(1)}`;
            const connectedBlockHeaders = frameHeaders[method]();
            const chain = listName.slice(0, 3);
            const txs = [].concat(...connectedBlockHeaders.map(header => header.getMarkedTxsList()));
            for (const tx of txs) {
              // The default token address is EMB
              if (balances[chain] === undefined) {
                balances[chain] = {};
              }
              if (balances[chain][tx.getToken()] === undefined) {
                balances[chain][tx.getToken()] = {};
              }
              // if it is from address SUBTRACT the total balance
              if (balances[chain][tx.getToken()][tx.getAddrFrom()] === undefined) {
                balances[chain][tx.getToken()][tx.getAddrFrom()] = '0';
              }

              if (balances[chain][tx.getToken()][tx.getAddrTo()] === undefined) {
                balances[chain][tx.getToken()][tx.getAddrTo()] = '0';
              }
              balances[chain][tx.getToken()][tx.getAddrFrom()] = new BN(balances[chain][tx.getToken()][tx.getAddrFrom()]).sub(new BN(tx.getValue())).toString();
              balances[chain][tx.getToken()][tx.getAddrTo()] = new BN(balances[chain][tx.getToken()][tx.getAddrTo()]).add(new BN(tx.getValue())).toString();
            }
          });
          // assign the latest marked transaction height
          await this.put(`${blockchain}.marked.latest`, block);
          // update the balances stored on disk
          await this.put(`${blockchain}.marked.balances`, JSON.stringify(balances));
          // store a snapshot every 3000 blocks
          if (new BN(block.getHeight()).mod(new BN(3000)).eq(new BN(0)) === true) {
            await this.put(`${blockchain}.marked.latest.snapshot`, block);
            await this.put(`${blockchain}.marked.balances.snapshot`, JSON.stringify(balances));
          }
        } catch (err) {
          return Promise.reject(err);
        }
      }
    }
    return true;
  }

  /**
   * Remove the block often used to remove stale orphans
   * @param hash string
   * @param blockchain string
   */
  async delBlock(hash, branch = 0, blockchain = 'bc', opts = {
    asBuffer: true,
    pruning: false
  }) {
    try {
      let block;
      let key;
      if (hash === undefined) {
        return Promise.resolve(false);
      } else if (is(Block, hash) || is(BcBlock, hash)) {
        block = hash;
        hash = block.getHash();
        key = `${blockchain}.block.${hash}`;
        this._blockByHashCache.del(key);
      } else {
        key = `${blockchain}.block.${hash}`;
        this._blockByHashCache.del(key);
        block = await this.get(key, opts);
      }
      if (block === undefined || block === false || block === null) {
        return Promise.resolve(true);
      } else if (block && block.getTxsList !== undefined && !opts.pruning) {
        // await this.resetMarkedBalancesFromBlock(block, blockchain)
      }

      const txsKey = `${blockchain}.txs.${hash}`;
      await this.delHashAtHeight(block.getHeight(), blockchain, block.getHash(), opts);
      await this.del(txsKey, opts);
      await this.del(key, opts);

      const txs = block && block.getTxsList !== undefined ? block.getTxsList() : block.getMarkedTxsList();
      for (let i = 0; i < txs.length; i++) {
        await this.delTransaction(txs[i], branch, blockchain, opts);
      }
      return Promise.resolve(true);
    } catch (err) {
      this._logger.error(err);
      return Promise.resolve(false);
    }
  }

  /**
   * Get transactions by block hash
   * @param {string} blockHash of the block which TX we want to get
   */
  async getTransactionsByBlockHash(blockHash, blockchain = 'bc', opts = { asBuffer: true }) {
    const key = `${blockchain}.txs.${blockHash}`; // TODO do we want the prefix?

    //debugReadOperations(`getTransactionsByBlockHash() ${key}`)
    //if (!this._readEventTable['getTransactionsByBlockHash']) {
    //  this._readEventTable['getTransactionsByBlockHash'] = 0
    //}
    //this._readEventTable['getTransactionsByBlockHash']++

    let txHashes;
    let txList;
    try {
      txHashes = await this.get(key, opts);
      if (txHashes === null) {
        this._logger.debug(`no txHashes found: ${key}`);
        return Promise.resolve(false);
      }
    } catch (err) {
      this._logger.debug(`Could not get tx hashes array for blockHash: ${blockHash}`, err.toString());
      return Promise.resolve(false);
    }

    try {
      txList = await this.getBulk(txHashes.map(hash => `${blockchain}.tx.${hash}`));
      // TODO do we want this check? Do we want to return the found TXs even if we did not found all of them in the persistence?
      if (txList.length !== txHashes.length) {
        this._logger.warn(`Found less TXs than number of hash references stored, hashes.length: ${txHashes.length}, txList.legnth: ${txList.length}`);
        return Promise.resolve(false);
      }
      return Promise.resolve(txList);
    } catch (err) {
      this._logger.error(`Could not get tx list for mr: ${blockHash}`, err.toString());
      return Promise.resolve(false);
    }
  }

  /**
   * Get block by hash with all transactions, reassembles blocks with transactions
   * @param blockchain string
   * @param hash string
   */
  async getBlockByHash(hash, blockchain = 'bc', opts = {
    asBuffer: true,
    asHeader: false,
    cached: false
  }) {
    const key = `${blockchain}.block.${hash}`;
    if (this._blockByHashCache.has(key)) {
      const b = this._blockByHashCache.get(key);
      if (b && b.getHash) {
        return b;
      }
    }
    let block = await this.get(key, opts);
    if (block === null) {
      debug(`no block found by hash ${hash}`);
      return false;
    }
    this._blockByHashCache.set(key, block);
    return block;
  }

  /**
   * Get block on main branch at a specific height
   * @param height string
   * @param blockchain string
   */
  async getBlockByHeight(height, blockchain = 'bc', opts = { asBuffer: true }) {
    if (isNaN(height)) return false;
    const key = `${blockchain}.block.${height}`;
    //debugReadOperations(`getBlockByHeight() ${key}`)
    //if (!this._readEventTable['getBlockByHeight']) {
    //  this._readEventTable['getBlockByHeight'] = 0
    //}
    //this._readEventTable['getBlockByHeight']++
    debug(`getBlocKByHeight() key ${key}`);
    let block;
    opts.asHashes = true;
    const hashes = await this.getBlocksByHeight(height, blockchain, opts);
    const uniqueHeight = !(hashes && hashes.length > 1);
    try {
      // if (opts.cached && this._blockByHeightCache.has(key) && uniqueHeight) {
      //   return Promise.resolve(this._blockByHeightCache.get(key))
      // }
      block = await this.get(key, opts);
      if (!block) {
        let result = false;
        // get as hashes so we only load the first option
        if (hashes && hashes.length > 0) {
          while (hashes.length > 0 && !result) {
            const h = hashes.shift();
            const firstBlockFromHeights = await this.getBlockByHash(h, blockchain, opts);
            if (firstBlockFromHeights) {
              result = firstBlockFromHeights;
              hashes.length = 0;
            }
          }
          if (!result) {
            return Promise.resolve(false);
          } else {
            return Promise.resolve(result);
          }
        } else {
          this._logger.debug(`Could not find blockKey by key ${key}`);
          return Promise.resolve(false);
        }
      }
    } catch (err) {
      this._logger.error(`Could not find block by height ${height}`, err.toString());
      return Promise.resolve(false);
    }
    try {
      if (block && block.getHash) {
        this._blockByHeightCache.set(`${blockchain}.block.${parseInt(block.getHeight(), 10)}`, block);
        this._blockByHashCache.set(`${blockchain}.block.${block.getHash()}`, block);
        if (!hashes || hashes.indexOf(block.getHash()) < 0) {
          await this.putBlockHashAtHeight(block.getHash(), parseInt(block.getHeight(), 10), blockchain);
        }
        return Promise.resolve(block);
      }
      return Promise.resolve(block);
    } catch (err) {
      return Promise.resolve(block);
    }
  }

  /**
   * Get complete block headers by height
   * @param height number
   * @param blockchain string
   */
  async getBlocksByHeight(height, blockchain = 'bc', opts = {
    asBuffer: true,
    iterateUp: true,
    asHashes: false,
    searchUp: false
  }) {
    if (isNaN(height)) return false;
    const key = `${blockchain}.height.${height}`; // TODO do we want the prefix? Better name than block_height_hashes?
    //debugReadOperations(`getBlocksByHeight() ${key}`)
    //if (!this._readEventTable['getBlocksByHeight']) {
    //  this._readEventTable['getBlocksByHeight'] = 0
    //}
    //this._readEventTable['getBlocksByHeight']++
    debug(`grabbing ${key} from persistence`);
    let blockHashes;
    let blockList = [];
    try {
      blockHashes = opts.cached === true && this._blocksByHeightCache.has(key) ? this._blocksByHeightCache.get(key) : await this.get(key, opts);
      // query db to get the list of hashes associated at a height
      if (opts.iterateUp || opts.searchUp) {
        let block = false;
        let bhs = blockHashes ? blockHashes : [];
        opts.searchUp = false;
        opts.iterateUp = false;
        if (opts.iterateUp) {
          const bls = await this.getBlocksByHeight(height + 1, blockchain, opts);
          if (bls) {
            for (let b of bls) {
              const hb = await this.getBlockByHash(b.getPreviousHash(), blockchain);
              blockList.push(hb);
              await this.putBlockHashAtHeight(b.getPreviousHash(), parseInt(b.getHeight(), 10) - 1, blockchain);
            }
          } else {
            block = await this.get(`${blockchain}.block.${height}`);
          }
        } else {
          const bls = await this.getBlocksByHeight(height, blockchain, opts);
          if (bls && bls.length && bls.length > 0) {
            if (opts.asHashes) {
              const s = sortBlockList(blockList);
              return s.map(a => {
                return a.getHash();
              });
            }
            return sortBlockList(blockList);
          } else {
            block = await this.get(`${blockchain}.block.${height}`);
          }
        }

        if (block) {
          blockList.push(block);
          await this.putBlockHashAtHeight(block.getHash(), parseInt(block.getHeight(), 10), blockchain);
          if (opts.asHashes) {
            blockHashes.push(block.getHash());
            return blockHashes;
          }
          return sortBlockList(blockList);
        } else if (blockList.length > 0) {
          if (opts.asHashes) {
            return blockHashes;
          }
          return sortBlockList(blockList);
        } else {
          const blockUp = await this.getBlockByHeight(height + 1, blockchain);
          if (!blockUp) {
            return false;
          }
          const b = await this.getBlockByHash(blockUp.getPreviousHash(), blockchain);
          if (!b) {
            return false;
          }
          await this.putBlockHashAtHeight(b.getHash(), parseInt(b.getHeight(), 10), blockchain);
          debug(`could not get block hashes for height: ${height}, with key ${key}`);
          if (opts.asHashes) {
            return [b.getHash()];
          }
          return [b];
        }
      }
      if (!Array.isArray(blockHashes)) {
        blockHashes = blockHashes.split(',');
      }
      // optionally only get the block hashes for scanning for potential orphans
      if (opts.asHashes) {
        return blockHashes;
      }

      blockList = await Promise.all(blockHashes.map(hash => {
        return this.getBlockByHash(hash, blockchain, opts);
      }));

      blockList = blockList.filter(b => {
        return b != undefined && b.getHash;
      });
      // console.log({height,blockList:blockList.length})
      if (blockList.length === 0) {
        const singleBlock = await this.getBlockByHeight(height, blockchain);
        if (singleBlock) {
          blockList.push(singleBlock);
        }
        return blockList;
      }

      // blockchain is not part of the multichain
      if (!blockList[0].getTotalDistance) {
        return sortBlockList(blockList);
      }

      return sortBlockList(blockList);
    } catch (err) {
      debug(`could not get block hashes for height: ${height}`, err.toString());
      return false;
    }
  }

  /**
   * Get blocks by range to -1 is latest
   * @param from number
   * @param to number
   * @param blockchain string
   */
  async getBlocksByRange(from, to, blockchain = 'bc', opts = {
    asBuffer: true,
    asSet: false,
    cached: false,
    searchUp: false
  }) {
    // from: 3, to: 30
    // XXX
    from = from - 2;

    if (to === -1) {
      const latestBlock = await this.get(`${blockchain}.block.latest`);
      if (latestBlock === null) {
        this._logger.error(new Error('could not find latest'));
        return false;
      }
      to = parseInt(latestBlock.getHeight(), 10);
    } else if (from > to) {
      const prevFrom = from;
      from = to;
      to = prevFrom;
    }
    let intervalSize = to - from + 1;
    if (intervalSize > 100) {
      debug('block range lookup limited to 100');
      intervalSize = 100;
      to = min(from + 100, to);
    }
    debugHeight(`getBlocksByRange(): request ${from}->${to} for ${blockchain}`);
    const heights = [...Array(intervalSize).keys()].map(k => {
      return k + from;
    });
    debugHeight(heights);
    debug(`getBlocksByRange() heights found: ${heights.length}`);
    if (!opts.asSet) {
      let topBlocks = await this.getBlocksByHeight(to);
      if (!topBlocks || topBlocks.length == 0) {
        topBlocks = await this.getBlockByHeight(to);
        if (topBlocks) topBlocks = [topBlocks];
      }
      let hash = await this.get(`bc.block.${to}.utxoSaved`);
      if (hash) {
        let block = await this.getBlockByHash(hash);
        if (block) topBlocks = [block];
      }
      if (topBlocks && topBlocks.length > 0) {
        let hashes = {};
        let blocks = [];
        for (let j = 0; j < topBlocks.length; j++) {
          let topBlock = topBlocks[j];
          blocks.push(topBlock);
          hashes[topBlock.getHash()] = true;
          let height = topBlock.getHeight();
          for (let i = 0; i < intervalSize; i++) {
            if (topBlock) topBlock = await this.getBlockByHash(topBlock.getPreviousHash());
            if (topBlock && !hashes[topBlock.getHash()]) {
              hashes[topBlock.getHash()] = true;
              blocks.push(topBlock);
            }
          }
          blocks.sort((a, b) => {
            if (a.getHeight() > b.getHeight()) {
              return 1;
            }
            if (b.getHeight() > a.getHeight()) {
              return -1;
            }
            return 0;
          });
        }
        return blocks;
      }

      let blocks = await Promise.all(heights.map(height => {
        return this.getBlocksByHeight(height, blockchain, opts);
      })).then(flatten);

      blocks = blocks.filter(b => {
        return b && b.getHash;
      });

      // let blocksBySingleHeight = await Promise.all(heights.map((height) => {
      //   return this.getBlockByHeight(height, blockchain, opts)
      // }))

      // for(let i = 0; i < blocksBySingleHeight;i++){
      //   let found = false;
      //   for(let j = 0; j < blocks.length; j++){
      //     if(blocksBySingleHeight[i] && blocksBySingleHeight[i].getHash() === blocks[j].getHash()) found = true;
      //   }
      //   if(!found){
      //     blocks.push(blocksBySingleHeight[i])
      //   }
      // }
      let hashes = {};
      let foundHeights = {};

      blocks.map(b => {
        hashes[b.getHash()] = true;
        foundHeights[b.getHeight()] = true;
      });

      for (let i = 0; i < heights.length; i++) {
        if (!foundHeights[heights[i]]) {
          let b = await this.getBlockByHeight(heights[i], blockchain, opts);
          if (b) {
            blocks.push(b);
          }
        }
      }

      let prevBlocks = [];
      for (let i = 0; i < blocks.length; i++) {
        if (!hashes[blocks[i].getPreviousHash()]) {
          let bl = await this.getBlockByHash(blocks[i].getPreviousHash(), blockchain, opts);
          if (bl) {
            debugHeight(`found block by prevhash ${blocks[i].getPreviousHash()}`);
            prevBlocks.push(bl);
          }
        }
      }

      blocks = blocks.concat(prevBlocks);

      blocks.sort((a, b) => {
        if (a.getHeight() > b.getHeight()) {
          return 1;
        }
        if (b.getHeight() > a.getHeight()) {
          return -1;
        }
        return 0;
      });

      blocks.map(b => {
        if (b) debugHeight(`found ${b.getHeight()}:${b.getHash()}`);
      });
      return blocks;
    } else {
      let blocks = await Promise.all(heights.map(height => {
        return this.getBlocksByHeight(height, blockchain, opts);
      })).then(flatten);
      blocks = blocks.filter(b => {
        if (b) {
          return b;
        }
      });
      blocks.sort((a, b) => {
        if (a.getHeight() > b.getHeight()) {
          return 1;
        }
        if (b.getHeight() > a.getHeight()) {
          return -1;
        }
        return 0;
      });
      const blockSet = blocks.reduce((all, block) => {
        if (Object.keys(all).length === 0) {
          all[block.getHash()] = [[block]];
        } else {
          let found = false;
          for (const mount of Object.keys(all)) {
            // if (found) { break }
            for (const branch of all[mount]) {
              if (found) {
                break;
              }
              for (const [i, b] of branch.entries()) {
                if (b.getHash() === block.getPreviousHash()) {
                  this._logger.info(`mount found for block ${b.getHeight()} previous hash ${block.getPreviousHash()}`);
                  if (i + 1 === branch.length) {
                    branch.push(block);
                    found = true;
                  } else {
                    const newBranch = branch.slice(0, i + 1);
                    newBranch.push(block);
                    found = true;
                    all[mount].push(newBranch);
                  }
                }
              }
            }
          }
          if (!found) {
            all[block.getHash()] = [[block]];
          }
        }
        return all;
      }, {});

      let best = null;
      for (const mount of Object.keys(blockSet)) {
        for (const branch of blockSet[mount]) {
          this._logger.info(`getBlocksByHeight(): ${from} -> ${to} checking branch of length ${branch.length}`);
          if (!best) {
            best = branch;
          } else if (best.length < branch.length) {
            best = branch;
          } else if (best.length === branch.length) {
            // if the branches are equal selectthe first (earliest) discovered branch
            if (last(best).getTimestamp() > last(branch).getTimestamp()) {
              best = branch;
            }
          }
        }
      }
      this._logger.info(`getBlocksByHeight(): ${from} -> ${to} branch of length ${best.length}`);
      return Promise.resolve(best);
    }
  }

  /**
   * Get blocks by range to -1 is latest, forces return of consecutive unique sequence
   * @param from number
   * @param to number
   * @param blockchain string
   */
  async getBlocksByRangeUnique(from, to, blockchain = 'bc', opts = {
    updateStorage: true,
    asBuffer: true
  }) {
    try {
      if (to === -1) {
        const latestBlock = await this.get(`${blockchain}.block.latest`);
        if (latestBlock === null) {
          this._logger.error(new Error('could not find latest'));
          return false;
        }
        to = parseInt(latestBlock.getHeight(), 10);
      } else if (from > to) {
        this._logger.error(new Error('from cannot be greater than to'));
        return false;
      }
      let intervalSize = to - from;
      if (intervalSize > 5000) {
        this._logger.warn('block range lookup limited to 5000');
        intervalSize = 5000;
        from = max(to - 5000, 2);
      }
      // [1,2,3,4,5]
      const heights = [...Array(intervalSize).keys()].map(k => {
        return k + from;
      });
      debug(`getBlocksByRangeUnique() heights found: ${heights.length}`);
      const rangeUnflattend = await Promise.all(heights.map(height => {
        return this.getBlocksByHeight(height, blockchain, opts);
      }));
      if (rangeUnflattend.length < 1) {
        return false;
      }
      const storage = {};
      const range = rangeUnflattend.reduce((all, blockList, index) => {
        this._logger.info(`storage: ${all.storage.length}, range: ${all.range.length}`);
        const previousHeight = parseInt(blockList[0].getHeight(), 10) - 1;
        if (all.break) {
          return all;
        }
        if (blockList.length > 1) {
          all.storage.push(blockList);
        } else if (all.storage.length > 0) {
          const chain = all.storage.reduce((a, bl) => {
            let searchHash = blockList[0].getPreviousHash();
            if (a.length !== 0) {
              searchHash = a[0].getPreviousHash();
            }
            for (const b of bl) {
              if (b.getHash() === searchHash) {
                a.unshift(b);
              }
            }
            return a;
          }, []);
          if (chain.length < 1) {
            all.break = true;
            return all;
          }
          for (const b of chain) {
            all.range.push(b);
          }
        } else {
          all.range.push(blockList[0]);
        }
        return all;
      }, { storage: [], range: [], break: false });

      range.range.reverse();

      // if (opts.updateStorage === true && range.range.length > 0) {
      //  for (let b of range.range) {
      //    await this.put(`${blockchain}.block.${b.getHeight()}`, b)
      //  }
      // }

      if (range.break && range.range.length < 1) {
        return false;
      } else {
        return range.range;
      }
      if (range.length < 1) {
        return false;
      }
      return range.range;
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  async getBlockByTxHash(txHash) {
    const id = `${BC_SUPER_COLLIDER}.txblock.${txHash}`;
    try {
      const key = this._blockByTxCache.has(id) ? this._blockByTxCache.get(id) : await this.get(id);
      if (key) {
        const [blockchain, _, hash, height] = key.split('.');
        const block = await this.getBlockByHash(hash, blockchain, { asHeader: true, cached: true });
        return block;
      }
      return null;
    } catch (err) {
      this._logger.error(err);
      return null;
    }
  }

  async getMarkedTxsForMatchedTx(txHash, txOutputIndex, latestBlock) {
    const makerMarkedTx = await this.get(`settle.tx.${txHash}.${txOutputIndex}.maker`);
    const takerMarkedTx = await this.get(`settle.tx.${txHash}.${txOutputIndex}.taker`);

    debugMarked({ makerMarkedTx, takerMarkedTx });
    // console.log({makerMarkedTx,takerMarkedTx})
    const markedTxs = [];
    let hash = {};

    const output = await this.getOutputByHashAndIndex(txHash, txOutputIndex);
    const [makerScript, _, __] = await this.getInitialMakerOrder(toASM(Buffer.from(output.getOutputScript()), 0x01), 0);
    let makerOrder = parseMakerLockScript(makerScript);

    for (const markedKey of [makerMarkedTx, takerMarkedTx]) {
      if (markedKey) {
        let shiftAmount = markedKey === makerMarkedTx ? makerOrder.shiftMaker : makerOrder.shiftTaker;

        let [, bcHeight, childChainId, childChainHeight,, markedTxHash] = markedKey.split('.');
        childChainId = `${childChainId[0].toUpperCase()}${childChainId.slice(1)}`;
        if (bcHeight.split(',').length > 4) {
          bcHeight = bcHeight.split(',')[4];
        }
        const bcBlock = await this.getBlockByHeight(bcHeight);
        const bcBlockNext = await this.getBlockByHeight(parseInt(bcHeight) + 1);

        // console.log({shiftAmount,bcHeight,childChainHeight,latestHeight:latestBlock.getHeight()});
        for (let block of [bcBlock, bcBlockNext]) {
          if (block) {
            for (const childBlock of block.getBlockchainHeaders()[`get${childChainId}List`]()) {
              if (childBlock.getHeight() === Number(childChainHeight)) {
                for (const markedTx of childBlock.getMarkedTxsList()) {
                  if (!wasabiBulletProofs.includes(markedTxHash) && markedTx.getHash() === markedTxHash && !hash[markedTxHash]) {
                    let pastShift = await this.isRoveredBlockPastShift(childBlock.getHash(), childBlock.getHeight(), childChainId, shiftAmount + 1, latestBlock);
                    // console.log({pastShift})
                    if (pastShift === 1) {
                      hash[markedTxHash] = true;
                      markedTxs.push(markedTx);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    // console.log({markedTxs})
    return markedTxs;
  }

  /**
   * Function used to associate a marked tx with a trade and vice versa
   */
  async settleTx(markedTxHash, childChainId, childChainHeight, childChainHash, bcHeight, txHash, txOutputIndex, isMaker) {
    try {
      const tradeParty = isMaker ? 'maker' : 'taker';

      const markedKey = `${BC_SUPER_COLLIDER}.${bcHeight}.${childChainId}.${childChainHeight}.markedTx.${markedTxHash}`;
      const tradeKey = `settle.tx.${txHash}.${txOutputIndex}.${tradeParty}`;
      const markTxSavedKey = `${childChainId}.${childChainHeight}.${markedTxHash}`;
      this._logger.info(`setting ${tradeKey} - ${markTxSavedKey} . ${childChainHash}`);

      // check if this marked tx is being used for any other tx
      let exists = await this.get(markedKey);
      if (exists) return false;

      // check if this tx already has a marked tx associated with it
      // exists = await this.get(tradeKey)
      // if (exists) return false
      if (bcHeight > 3470000) {
        exists = await this.get(markTxSavedKey);
        if (exists) return false;
      }

      if (bcHeight > 2590000) {
        await this.put(`${markedKey}.hash`, childChainHash);
        await this.put(`${markedTxHash}.ref`, markedKey);
      }

      await this.put(markedKey, tradeKey);
      await this.put(tradeKey, markedKey);
      await this.put(markTxSavedKey, true);

      return true;
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  async isRoveredBlockPastShift(childChainHash, childChainHeight, childChainId, shiftAmount, latestBlock) {
    try {
      debugShift(`calling isRoveredBlockPastShift comparing ${childChainHash},${childChainHeight}`);

      //TODO marked transaction exception for early blocks
      if (childChainHash === '0xe090383a83251a725ba4299e7fece2a0ac4f297132b3a877926099fdc9edc077') return 1;
      if (childChainHash === '0xb481ec526c2048dfe9cc4e77cb7aaf73446853985b30ab8df79ec889b6b38031') return 1;
      if (childChainHash === '0x4b79118c62345c4ae5b59ca3b43451e63c88b48767147cd901494d355def0c4d') return 1;
      if (childChainHash === '0000000000000000000d90bff6481154971c0ef6cad6be9da9f29cdc6da7bb24') return 1;
      if (childChainHash === '0x622524f7ef61719883712b0c431dd8d87949a8c3b4a05c086eafbb6f701d0547') return -1;

      let isPastShift = await this.get(`${childChainHeight}.${childChainHeight}.${childChainId.toLowerCase()}.${shiftAmount}`);
      // TODO remove in future
      // this is just a safe measure for transitional period of code not using childChainId.toLowerCase in put
      if (isPastShift === null) {
        isPastShift = await this.get(`${childChainHeight}.${childChainHeight}.${childChainId}.${shiftAmount}`);
      }
      // TODO END remove in future
      if (isPastShift) {
        debugShift(`${childChainHash},${childChainHeight} is past shift`);
        return 1;
      }

      if (!latestBlock) latestBlock = await this.get(`bc.block.last.utxoSaved`);
      if (!latestBlock) {
        debug('latest block not saved');
        return false;
      }

      let block = last(getChildBlocks(latestBlock, childChainId.toLowerCase()));
      if (block.getHeight() >= Number(childChainHeight) + shiftAmount) {
        while (block && block.getHeight() >= Number(childChainHeight)) {
          debugShift(`comparing ${childChainId} ${block.getHeight()} ${block.getHash()} with ${childChainHeight} ${childChainHash}`);

          if (block.getHash() === childChainHash) {
            await this.put(`${childChainHeight}.${childChainHeight}.${childChainId.toLowerCase()}.${shiftAmount}`, true);
            debugShift(`${childChainHash},${childChainHeight} is past shift`);
            return 1; // block is all good
          }
          let block1 = block;
          //eth
          if (childChainId.toLowerCase() === 'eth' && block.getHeight() === 11098412) {
            block = await this.getBlockByHeight(10860843, childChainId.toLowerCase());
          }
          if (childChainId.toLowerCase() === 'eth' && block.getHeight() === 11761765) {
            block = await this.getBlockByHeight(11761763, childChainId.toLowerCase());
          }
          if (childChainId.toLowerCase() === 'eth' && block.getHeight() === 11964696) {
            block = await this.getBlockByHeight(11964694, childChainId.toLowerCase());
          }
          if (childChainId.toLowerCase() === 'eth' && block.getHeight() === 12096606) {
            block = await this.getBlockByHeight(12096604, childChainId.toLowerCase());
          }
          //btc
          else if (childChainId.toLowerCase() === 'btc' && block.getHeight() === 653667) {
              block = await this.getBlockByHeight(648911, childChainId.toLowerCase());
            }
            //wav
            else if (childChainId.toLowerCase() === 'wav' && block.getHeight() === 2293805) {
                block = await this.getBlockByHeight(2246282, childChainId.toLowerCase());
              }
              //lsk
              else if (childChainId.toLowerCase() === 'lsk' && block.getHeight() === 13653633) {
                  block = await this.getBlockByHeight(13370665, childChainId.toLowerCase());
                }
                //neo
                else if (childChainId.toLowerCase() === 'neo' && block.getHeight() === 6338357) {
                    block = await this.getBlockByHeight(6179160, childChainId.toLowerCase());
                  } else {
                    block = await this.getBlockByHash(block.getPreviousHash(), childChainId.toLowerCase());
                  }
          //block was not saved by hash, check height
          if (!block) {
            let blocks = await this.getBlocksByHeight(block1.getHeight() - 1, childChainId.toLowerCase());
            if (blocks) blocks = blocks.filter(b => {
              return b.getHash() === block1.getPreviousHash();
            });
            if (blocks.length === 1) {
              block = blocks[0];
              await this.putBlock(block, 0, block.getBlockchain());
            }
          }
        }

        debugShift(`${childChainId} ${childChainHeight} ${childChainHash} is invalid`);
        return -1; // block was actually invalid
      } else {
        // waiting for shift period to pass
        debugShift(`waiting for shift period to pass for ${childChainId} ${childChainHash} ${childChainHeight}`);
        return 0;
      }
    } catch (err) {
      console.log({ err });
      return false;
    }
  }

  /**
  * Function used to update Emblem balance
  */
  async settleEmbTx({ to, from, chain, amount, height, tokenType, hash, childHash }, block) {
    try {
      const isUniqueEMBTx = await this.get(`${chain}.${tokenType}.${hash}.${childHash}.${height}`);

      if (parseInt(block.getHeight(), 10) > 3220968 && from === "0xa04c144bc6a9fb4a88dd3bbc2df2d22abaa07640" || from === "0x1fc47bbf806dc6498f97d769483f6d986622d395" && parseInt(block.getHeight(), 10) > 3220968 || parseInt(block.getHeight(), 10) > 3220968 && from === "0xaa8dbb478152cce333ea51fdf91e6b09875d8bb8") {
        await this.del(`${chain}.${tokenType}.${EMBLEM_CONTRACT_ADDRESS}.${from}.credit`);
      }

      if (!isUniqueEMBTx) {
        debugEMBBalance(`settleEmbTx(): to: ${to}, from: ${from}, amount: ${amount.toNumber()}`);
        //RUN EMB UPDATE HERE
        await this.put(`${chain}.${tokenType}.${hash}.${childHash}.${height}`, `${block.getHeight()}.${block.getHash()}`);

        const timestamp = Math.floor(Date.now() / 1000);
        const toBalanceKey = `${chain}.${tokenType}.${EMBLEM_CONTRACT_ADDRESS}.${to}.credit`;
        const fromBalanceKey = `${chain}.${tokenType}.${EMBLEM_CONTRACT_ADDRESS}.${from}.credit`;
        let fromBalanceAmount = false;

        // first attempt to remove any EMB at the from Balance location (note this does may not match the child chain balance, and that is ok)
        const fromBalance = await this.get(fromBalanceKey);

        if (fromBalance && to === from) {
          let oldAmount = parseInt(fromBalance.split(":")[0], 10);
          //if new amount exceeds old amount, update key
          if (new BN(amount).gt(new BN(oldAmount))) {
            await this.put(fromBalanceKey, `${amount.toNumber()}:${height}:${timestamp}`);
          }
          debugEMBBalance(`settleEmbTx(): to === from <- returning`);
          return;
        }

        if (fromBalance) {
          fromBalanceAmount = parseInt(fromBalance.split(":")[0], 10);
          const updatedFromBalance = new BN(fromBalanceAmount).sub(new BN(amount));
          this._logger.info(`settle emb from updated balance: ${updatedFromBalance}`);
          if (0 >= updatedFromBalance.toNumber()) {
            await this.del(fromBalanceKey);
          } else {
            await this.put(fromBalanceKey, `${updatedFromBalance.toNumber()}:${height}:${timestamp}`);
          }
        } else {
          debugEMBBalance(`settleEmbTx(): from ${from} <- has no previous balance`);
        }

        // second attempt to update the to balance
        const toBalance = to === from && fromBalanceAmount ? fromBalance : await this.get(toBalanceKey);
        if (!toBalance) {
          debugEMBBalance(`settleEmbTx(): to ${to} has NO previous balance <- new amount: ${amount.toNumber()}`);
          await this.put(toBalanceKey, `${amount.toNumber()}:${height}:${timestamp}`);
        } else {
          const toBalanceAmount = parseInt(toBalance.split(":")[0], 10);
          const updatedToBalance = new BN(toBalanceAmount).add(new BN(amount));
          debugEMBBalance(`settleEmbTx(): to ${to} HAS previous balance <- new total amount: ${updatedToBalance.toNumber()}`);
          await this.put(toBalanceKey, `${updatedToBalance.toNumber()}:${height}:${timestamp}`);
        }
      } else {
        debugEMBBalance(`settleEmbTx(): not unique -> to: ${to}, from: ${from}, amount: ${amount.toNumber()}`);
      }
      return;
    } catch (err) {
      this._logger.error(err);
    }
  }

  /**
  * Function used to return Emblem balance
  */
  async unsettleEmbTx({ to, from, chain, amount, height, tokenType, hash, childHash }, block) {
    try {
      const isUniqueEMBTx = await this.get(`${chain}.${tokenType}.${hash}.${childHash}.${height}`);
      if (isUniqueEMBTx === `${block.getHeight()}.${block.getHash()}`) {
        debugEMBBalance(`unsettleEmbTx():  to: ${to}, from: ${from}, amount: ${amount.toNumber()}`);

        await this.del(`${chain}.${tokenType}.${hash}.${childHash}.${height}`);

        const timestamp = Math.floor(Date.now() / 1000);
        const toBalanceKey = `${chain}.${tokenType}.${EMBLEM_CONTRACT_ADDRESS}.${to}.credit`;
        const fromBalanceKey = `${chain}.${tokenType}.${EMBLEM_CONTRACT_ADDRESS}.${from}.credit`;
        const toBalanceKeyMiner = `${chain}.${tokenType}.${EMBLEM_CONTRACT_ADDRESS}.${to}.miner`;
        const fromBalanceKeyMiner = `${chain}.${tokenType}.${EMBLEM_CONTRACT_ADDRESS}.${from}.miner`;

        await this.del(toBalanceKeyMiner);
        await this.del(fromBalanceKeyMiner);

        // first attempt to readd any EMB to the original address
        const fromBalance = await this.get(fromBalanceKey);
        if (fromBalance && to === from) {
          return;
        }
        let fromBalanceAmount = false;
        if (fromBalance) {
          fromBalanceAmount = parseInt(fromBalance.split(":")[0], 10);
          const updatedFromBalance = new BN(fromBalanceAmount).add(new BN(amount));
          debugEMBBalance(`unsettleEmbTx(): from balance exist total amount: ${updatedFromBalance.toNumber()}`);
          await this.put(fromBalanceKey, `${updatedFromBalance.toNumber()}:${height}:${timestamp}`);
        } else {
          await this.put(fromBalanceKey, `${amount.toNumber()}:${height}:${timestamp}`);
        }

        // second attempt to update the to balance
        const toBalance = from === to && fromBalanceAmount ? fromBalance : await this.get(toBalanceKey);
        if (toBalance) {
          const toBalanceAmount = parseInt(toBalance.split(":")[0], 10);
          const updatedToBalance = new BN(toBalanceAmount).sub(new BN(amount));
          debugEMBBalance(`unsettleEmbTx(): to balance exist total amount: ${updatedToBalance.toNumber()}`);
          if (0 >= updatedToBalance.toNumber()) {
            await this.del(toBalanceKey);
          } else {
            await this.put(toBalanceKey, `${updatedToBalance.toNumber()}:${height}:${timestamp}`);
          }
        }
      } else {
        debugEMBBalance(`unsettleEmbTx(): not unique -> to: ${to}, from: ${from}, amount: ${amount.toNumber()}`);
      }
      return;
    } catch (err) {
      this._logger.error(err);
    }
  }

  /**
   * Function used to unassociate a marked tx with a trade and vice versa when in an uncle block
   */
  async unsettleUncleTx(markedTxHash) {
    try {
      let ref = await this.get(`${markedTxHash}.ref`);
      debugSettle(`unsettling ${markedTxHash}`);
      if (ref) {
        let markedKey = await this.get(ref);
        let [, bcHeight, childChainId, childChainHeight,, hash] = markedKey.split('.');
        if (bcHeight.split(',').length > 4) {
          bcHeight = bcHeight.split(',')[4];
        }
        let tradeKey = await this.get(markedKey);
        const markTxSavedKey = `${childChainId}.${childChainHeight}.${markedTxHash}`;
        await this.del(markedKey);
        await this.del(`${markedKey}.hash`);
        await this.del(tradeKey);
        await this.del(markTxSavedKey);
        await this.del(`${markedTxHash}.ref`);

        //removed succesfully
        return true;
      }
      //did not have ref
      else return false;
    } catch (err) {
      this._logger.info(`unsettle tx err - ${err}`);
      return false;
    }
  }

  /**
   * Function used to unassociate a marked tx with a trade and vice versa
   */
  async unsettleTx(markedTxHash, childChainId, childChainHeight, childChainHash, bcHeight, txHash, txOutputIndex, isMaker) {
    try {
      const tradeParty = isMaker ? 'maker' : 'taker';

      const markedKey = `${BC_SUPER_COLLIDER}.${bcHeight}.${childChainId}.${childChainHeight}.markedTx.${markedTxHash}`;
      const tradeKey = `settle.tx.${txHash}.${txOutputIndex}.${tradeParty}`;
      const markTxSavedKey = `${childChainId}.${childChainHeight}.${markedTxHash}`;

      const markedExisting = await this.get(markedKey);
      const tradeExisting = await this.get(tradeKey);

      if (markedKey === tradeExisting && tradeKey === markedExisting) {
        await this.del(markedKey);
        await this.del(`${markedKey}.hash`);
        await this.del(tradeKey);
        await this.del(markTxSavedKey);
        await this.del(`${markedTxHash}.ref`);
      }

      return true;
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  async getChildChainDetailsForOrder(txHash, txOutputIndex, isMaker) {
    const tradeParty = isMaker ? 'maker' : 'taker';
    const tradeKey = `settle.tx.${txHash}.${txOutputIndex}.${tradeParty}`;
    try {
      // 0 edge case
      const output = await this.getOutputByHashAndIndex(txHash, txOutputIndex);
      const [makerScript, _, __] = await this.getInitialMakerOrder(toASM(Buffer.from(output.getOutputScript()), 0x01), 0);
      let makerOrder = parseMakerLockScript(makerScript);
      let shiftAmount = isMaker ? makerOrder.shiftMaker : makerOrder.shiftTaker;

      const { receivesUnit, sendsUnit } = parseMakerLockScript(makerScript);
      if (receivesUnit === '0' && !isMaker) return true;
      if (sendsUnit === '0' && isMaker) return true;

      const markedKey = await this.get(tradeKey);

      if (!markedKey) {
        return false;
      }

      const checkTradeKey = await this.get(markedKey);

      if (tradeKey !== checkTradeKey) return false;

      let [, bcHeight, childChainId, childChainHeight,, markedTxHash] = markedKey.split('.');
      if (bcHeight.split(',').length > 4) {
        bcHeight = bcHeight.split(',')[4];
      }
      if (wasabiBulletProofs.includes(markedTxHash)) return false;

      const bcBlock = await this.getBlockByHeight(bcHeight);
      const bcBlockNext = await this.getBlockByHeight(parseInt(bcHeight) + 1);

      // found the marked key, double check it is actually within the appropriate BC block and its child block
      for (let block of [bcBlock, bcBlockNext]) {
        if (block) {
          for (const childBlock of getChildBlocks(block, childChainId.toLowerCase())) {
            if (childBlock.getHeight() === Number(childChainHeight)) {
              for (const markedTx of childBlock.getMarkedTxsList()) {
                if (markedTx.getHash() === markedTxHash) {
                  return { childBlock, shiftAmount };
                }
              }
            }
          }
        }
      }
      this._logger.info(`couldn't find block ${childChainId} at ${childChainHeight}, started check from bc height ${bcHeight}`);
      return false;
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  /**
   * Function used to check if there is a marked tx associated with the trade
   *
   */
  async isTxSettled(txHash, txOutputIndex, isMaker) {
    const tradeParty = isMaker ? 'maker' : 'taker';
    const tradeKey = `settle.tx.${txHash}.${txOutputIndex}.${tradeParty}`;
    debugSettle(`searching for ${tradeKey}`);
    try {
      // 0 edge case
      let output = await this.getOutputByHashAndIndex(txHash, txOutputIndex);
      if (!output) {
        const block = await this.getBlockByTxHash(txHash);
        if (block && block.getTxsList) {
          let txs = block.getTxsList().filter(tx => {
            return tx.getHash() === txHash;
          });
          if (txs.length === 1) {
            await this.putTransaction(txs[0], block.getHash(), 0, 'bc');
            output = await this.getOutputByHashAndIndex(txHash, txOutputIndex);
            if (!output) {
              debugSettle(`unable to get tx hash from ${txHash} after local storage update`);
              return false;
            }
          } else {
            debugSettle(`unable to get get tx hash from ${txHash} after parent block search`);
            return false;
          }
        } else {
          debugSettle(`unable to get tx hash from ${txHash}`);
          return false;
        }
      }
      const [makerScript, _, __] = await this.getInitialMakerOrder(toASM(Buffer.from(output.getOutputScript()), 0x01), 0);
      let makerOrder = parseMakerLockScript(makerScript);
      let shiftAmount = isMaker ? makerOrder.shiftMaker : makerOrder.shiftTaker;

      const { receivesUnit, sendsUnit } = parseMakerLockScript(makerScript);
      if (receivesUnit === '0' && !isMaker) return true;
      if (sendsUnit === '0' && isMaker) return true;

      const markedKey = await this.get(tradeKey);

      debugSettle(`marked key for ${tradeKey} is ${markedKey}`);

      if (!markedKey) {
        return false;
      }

      const checkTradeKey = await this.get(markedKey);

      if (tradeKey !== checkTradeKey) return false;

      let [, bcHeight, childChainId, childChainHeight,, markedTxHash] = markedKey.split('.');
      if (bcHeight.split(',').length > 4) {
        bcHeight = bcHeight.split(',')[4];
      }
      if (wasabiBulletProofs.includes(markedTxHash)) return false;

      const bcBlock = await this.getBlockByHeight(bcHeight);
      const bcBlockNext = await this.getBlockByHeight(parseInt(bcHeight) + 1);

      // found the marked key, double check it is actually within the appropriate BC block and its child block
      for (let block of [bcBlock, bcBlockNext]) {
        if (block) {
          for (const childBlock of getChildBlocks(block, childChainId.toLowerCase())) {
            if (childBlock.getHeight() === Number(childChainHeight)) {
              for (const markedTx of childBlock.getMarkedTxsList()) {
                if (markedTx.getHash() === markedTxHash) {
                  let pastShift = await this.isRoveredBlockPastShift(childBlock.getHash(), childBlock.getHeight(), childChainId, shiftAmount + 1);
                  debugSettle(`shift for ${tradeKey} is ${pastShift}`);
                  if (pastShift === -1 || pastShift === false) return false;else return true;
                }
              }
            }
          }
        }
      }
      this._logger.info(`couldn't find block ${childChainId} at ${childChainHeight}`);
      return false;
    } catch (err) {
      // this._logger.error(`error with ${txHash}, ${txOutputIndex}, ${isMaker}`)
      this._logger.error(err);
      return false;
    }
  }

  /**
   * Checks if the tx settlement is over
   *
   */
  async isTxWithinSettlement(txHash, txOutputIndex, latest, onlyMaker = false) {
    try {
      // should be the taker tx hash
      const tx = await this.getTransactionByHash(txHash);
      const block = await this.getBlockByTxHash(txHash); // getOutputByHashAndIndex
      let latestBlock = latest;
      if (!latestBlock) latestBlock = await this.get(`${BC_SUPER_COLLIDER}.block.last.utxoSaved`);

      if (!tx || !block || !latestBlock) {
        return false;
      }

      if (latestBlock.getHeight() === 2922059 && txHash === 'dde030f38b19275e4d5e9e8a27b652e9fecb9013b59917e3b80aefc34de1fe2d') return false;

      // the original maker order
      const outputScript = toASM(Buffer.from(tx.getOutputsList()[txOutputIndex].getOutputScript()), 0x01);
      const [originalScript, originalBlockHeight, originalMakerTxOutput] = await this.getInitialMakerOrder(outputScript, block.getHeight());

      const { settlement, shiftMaker, shiftTaker, receivesToChain, sendsFromChain } = parseMakerLockScript(originalScript);

      // console.log({settlement,shiftMaker,shiftTaker});
      // if the latest block height is below the settlement, we are within the window
      if (originalBlockHeight + settlement > latestBlock.getHeight()) {
        return true;
      } else {
        // check to see if the taker/maker is within the shift window
        // block at which tx settlement ends
        const settleBlock = await this.getBlockByHeight(originalBlockHeight + settlement);

        const lastestChildMaker = last(getChildBlocks(latestBlock, sendsFromChain)).getHeight();
        const lastestChildTaker = last(getChildBlocks(latestBlock, receivesToChain)).getHeight();
        const settleChildMaker = last(getChildBlocks(settleBlock, sendsFromChain)).getHeight() + parseFloat(shiftMaker) + 1;
        const settleChildTaker = last(getChildBlocks(settleBlock, receivesToChain)).getHeight() + parseFloat(shiftTaker) + 1;
        // console.log({settleChildMaker,lastestChildMaker})
        if (onlyMaker) {
          if (settleChildMaker <= lastestChildMaker) {
            return false;
          } else {
            return true;
          }
        } else {
          let takerDetails = await this.getChildChainDetailsForOrder(txHash, txOutputIndex, false);
          let makerDetails = await this.getChildChainDetailsForOrder(txHash, txOutputIndex, true);

          //taker order is still within shift
          if (takerDetails) {
            let pastShiftTaker = await this.isRoveredBlockPastShift(takerDetails.childBlock.getHash(), takerDetails.childBlock.getHeight(), takerDetails.childBlock.getBlockchain(), takerDetails.shiftAmount + 1, latestBlock);
            if (pastShiftTaker === 0) return true;
          }

          //maker order is still within shift
          if (makerDetails) {
            let pastShiftMaker = await this.isRoveredBlockPastShift(makerDetails.childBlock.getHash(), makerDetails.childBlock.getHeight(), makerDetails.childBlock.getBlockchain(), makerDetails.shiftAmount + 1, latestBlock);
            if (pastShiftMaker === 0) return true;
          }

          if (settleChildMaker <= lastestChildMaker && settleChildTaker <= lastestChildTaker) {
            return false;
          } else {
            return true;
          }
        }
      }
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  /**
   * Get the original maker script and height for a callback script
   *
   */
  async getInitialMakerOrder(outputScript, blockHeight = 0) {
    let _makerTxOutput = null;
    let parentTxHash = null;
    let parentOutputIndex = 0;
    while (outputScript.includes('OP_CALLBACK')) {
      const str = outputScript.split(' ');
      parentTxHash = str[0];
      parentOutputIndex = str[1];
      let _makerTx = await this.getTransactionByHash(parentTxHash, 'bc');
      if (!_makerTx) this._logger.info(`cannot find initial maker ${parentTxHash}`);
      _makerTxOutput = _makerTx.getOutputsList()[parseInt(parentOutputIndex)];
      outputScript = toASM(Buffer.from(_makerTxOutput.getOutputScript()), 0x01);
    }
    if (parentTxHash) {
      const block = await this.getBlockByTxHash(parentTxHash);
      if (block) blockHeight = block.getHeight();
    }
    return [outputScript, blockHeight, _makerTxOutput];
  }

  /**
   * Get the original maker script and height for a callback script with the tx hash and index
   *
   */
  async getInitialMakerOrderWithTxAndIndex(outputScript, blockHeight = 0) {
    let _makerTxOutput = null;
    let tx;
    let txOutputIndex;
    let parentTxHash = null;
    let parentOutputIndex = 0;
    while (outputScript.includes('OP_CALLBACK')) {
      const str = outputScript.split(' ');
      parentTxHash = str[0];
      parentOutputIndex = str[1];
      const _makerTx = await this.getTransactionByHash(parentTxHash, 'bc');
      _makerTxOutput = _makerTx.getOutputsList()[parentOutputIndex];
      outputScript = toASM(Buffer.from(_makerTxOutput.getOutputScript()), 0x01);
      tx = _makerTx;
      txOutputIndex = parentOutputIndex;
    }
    if (parentTxHash) {
      const block = await this.getBlockByTxHash(parentTxHash);
      if (block) blockHeight = block.getHeight();
    }
    const res = [outputScript, blockHeight, tx, txOutputIndex];
    return res;
  }

  async getUnlockTakerTxParams(txHash, txOutputIndex) {
    const res = { scripts: [], value: null };
    const isWithinSettlement = await this.isTxWithinSettlement(txHash, txOutputIndex);
    const output = await this.getOutputByHashAndIndex(txHash, txOutputIndex);
    if (!output) return res;
    const takerOutputScript = toASM(Buffer.from(output.getOutputScript()), 0x01);
    const [makerScript, _, __] = await this.getInitialMakerOrder(takerOutputScript, 0);
    if (takerOutputScript === makerScript || getScriptType(output.getOutputScript()) === 'taker_callback') {
      res.scripts = [makerScript.split(' OP_MONAD ')[1].split(' OP_ENDMONAD')[0].trim()];
      res.value = output.getValue();
    }
    // we are not in settlement window and can now unlock the tx
    else if (!isWithinSettlement) {
        // check if either settled
        const didMakerSettle = await this.isTxSettled(txHash, txOutputIndex, true);
        const didTakerSettle = await this.isTxSettled(txHash, txOutputIndex, false);

        // get the spending scripts for both taker and maker
        res.value = output.getValue();

        const { base } = parseMakerLockScript(makerScript);

        const takerUnlockScript = takerOutputScript.split(' OP_MONAD ')[1].split(' OP_ENDMONAD')[0].trim();

        const makerUnlockScript = makerScript.split(' OP_MONAD ')[1].split(' OP_ENDMONAD')[0].trim();

        let scripts = [];
        if (didMakerSettle === didTakerSettle) {
          scripts = [takerUnlockScript, makerUnlockScript];
        } else if (didMakerSettle) scripts = [makerUnlockScript];else if (didTakerSettle) scripts = [takerUnlockScript];

        if (base == 1 && didMakerSettle === didTakerSettle) {
          scripts = [makerUnlockScript];
        }
        res.scripts = scripts;
      }
    return res;
  }

  /**
   * Runs a report on the current blockchain state
   */
  async getMultichainReport() {

    const startBlock = await this.get(`${BC_SUPER_COLLIDER}.block.latest`);

    if (!startBlock) {
      this._logger.error(new Error('unable to locate latest block'));
      return;
    }

    this._logger.warn(`getMultichainReport(): multichain running report `);
    this._logger.warn(`waiting 10 seconds CTRL-C to cancel...`);

    return new Promise(async (resolve, reject) => {

      try {

        this._logger.info(`starting dry run...`);
        const report = {
          children: 0
        };
        let depth = parseInt(startBlock.getHeight(), 10);
        let nextBlockHash = startBlock.getPreviousHash();
        let discovered = 0;
        while (depth > 1000) {
          this._logger.info(`processing height ${depth - 1}, discovered: ${discovered}`);
          const block = await this.getBlockByHash(nextBlockHash, BC_SUPER_COLLIDER, { asHeader: true });
          depth = block ? parseInt(block.getHeight(), 10) : parseInt(startBlock.getHeight(), 10);
          if (!block) {
            this._logger.error(`unable to find block at depth ${depth} for hash ${nextBlockHash}`);
            depth = 0;
            break;
          } else {
            //ensure child blocks are saved
            const headersMap = block.getBlockchainHeaders();
            let uniqueChildren = 0;
            let children = [];
            let methodNames = Object.keys(headersMap.toObject());

            for (let i = 0; i < methodNames.length; i++) {
              let rover = methodNames[i];
              const getMethodName = `get${rover[0].toUpperCase()}${rover.slice(1)}`;
              const childBlocks = headersMap[getMethodName]();
              children = concat(children, childBlocks);
            }

            for (let c of children) {
              if (!report[c.getHash()]) {
                report[c.getHash()] = 1;
                uniqueChildren++;
              }
            }

            report.children = report.children + uniqueChildren;
            discovered = discovered + children.length;
            nextBlockHash = block.getPreviousHash();
          }
        }

        this._logger.info(`index run complete <- discovered: ${discovered}, unique children: ${report.children}`);

        resolve(true);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Removes a lagging index of blocks from a given block height
   */
  async pruneMultichain() {

    const startBlock = await this.get(`${BC_SUPER_COLLIDER}.block.latest`);

    if (!startBlock) {
      this._logger.error(new Error('unable to locate latest block'));
      return;
    }

    this._logger.warn(`pruneMultichain(): removing all blocks not attached to chain from ${startBlock.getHeight()} : ${startBlock.getHash()}...`);
    this._logger.warn(`waiting 10 seconds CTRL-C to cancel...`);

    return new Promise(async (resolve, reject) => {

      try {

        this._logger.info(`starting dry run...`);
        const hashesForPruning = [];
        let depth = parseInt(startBlock.getHeight(), 10);
        let nextBlockHash = startBlock.getPreviousHash();
        let discovered = 0;
        while (depth > 1000) {
          this._logger.info(`processing height ${depth - 1}, for pruning: ${hashesForPruning.length}, discovered: ${discovered}, rate: ${Math.floor(hashesForPruning.length / discovered) * 100}`);
          const block = await this.getBlockByHash(nextBlockHash, BC_SUPER_COLLIDER, { asHeader: true });
          depth = block ? parseInt(block.getHeight(), 10) : parseInt(startBlock.getHeight(), 10);
          if (!block) {
            this._logger.error(`unable to find block at depth ${depth} for hash ${nextBlockHash}`);
            depth = 0;
            break;
          } else {
            //ensure child blocks are saved
            const headersMap = block.getBlockchainHeaders();
            let children = [];
            let methodNames = Object.keys(headersMap.toObject());

            for (let i = 0; i < methodNames.length; i++) {
              let rover = methodNames[i];
              const getMethodName = `get${rover[0].toUpperCase()}${rover.slice(1)}`;
              const childBlocks = headersMap[getMethodName]();
              children = concat(children, childBlocks);
            }
            for (let i = 0; i < children.length; i++) {
              let child = children[i];
              let hashSaved = await this.get(`${child.getBlockchain()}.block.${child.getHash()}`);
              if (!hashSaved) {
                this._logger.info(`saving ${child.getBlockchain()}.block.${child.getHash()}`);
                await this.put(`${child.getBlockchain()}.block.${child.getHash()}`, child);
              }
              let heightSaved = await this.get(`${child.getBlockchain()}.block.${child.getHeight()}`);
              if (!heightSaved) {
                this._logger.info(`saving ${child.getBlockchain()}.block.${child.getHeight()}`);
                await this.put(`${child.getBlockchain()}.block.${child.getHeight()}`, child);
              }
            }

            let hashes = await this.getBlocksByHeight(parseInt(block.getHeight(), 10), BC_SUPER_COLLIDER, { asHashes: true });

            if (!hashes) {
              hashes = [];
            }

            hashes = hashes.reduce((all, h) => {
              if (h.getHash) {
                all.push(h.getHash());
              } else if (h && h.length > 2) {
                all.push(h);
              }
              return all;
            }, []);

            if (hashes.indexOf(block.getHash()) < 0) {
              this._logger.info(`updating block index at height: ${depth}`);
              await this.putBlockHashAtHeight(block.getHash(), depth, BC_SUPER_COLLIDER);
              hashes.push(block.getHash());
            }

            if (hashes.length > 1) {
              for (let hash of hashes) {
                if (hashesForPruning.indexOf(hash) < 0 && hash !== block.getHash()) {
                  hashesForPruning.push(hash);
                  this._logger.info(`removing ${hash}`);
                  await this.delBlock(hash, 0, BC_SUPER_COLLIDER, { pruning: true });
                }
              }
            }
            discovered = discovered + hashes.length;
            nextBlockHash = block.getPreviousHash();
          }
        }

        this._logger.info(`index run complete <- discovered: ${discovered}, pruned: ${hashesForPruning.length}`);

        hashesForPruning.reverse();

        // while (hashesForPruning.length > 0) {
        //   const h = hashesForPruning.pop()
        //   this._logger.info(`removing ${hashesForPruning.length} -> ${h}`)
        //   await this.delBlock(h, 0, BC_SUPER_COLLIDER, {pruning: true})
        // }

        resolve(true);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Removes a lagging index of blocks from a given block height
   */
  async pruneFromBlock(block, depth = 12, confirmations = 6, defaultBlockchain = 'bc') {

    try {
      if (!block) {
        throw new Error('no block provided');
      }

      if (!depth || depth < 2) {
        throw new Error(`invalid depth provided ${depth}`);
      }

      if (!confirmations || confirmations < 2) {
        throw new Error(`invalid depth provided ${depth}`);
      }

      if (parseInt(block.getHeight(), 10) - (depth + confirmations) < 2) {
        this._logger.info(`pruning up to genesis block is complete at height ${block.getHeight()}`);
        return Promise.resolve(true);
      }

      const blockchain = block.getBlockchain ? block.getBlockchain() : defaultBlockchain;
      const givenConfirmations = confirmations;
      let b = block;
      while (confirmations > 0 && b) {
        b = await this.getBlockByHash(b.getPreviousHash(), blockchain, { asHeader: true });
        confirmations--;
      }

      if (confirmations > 0) {
        this._logger.warn(`unable to find required confirmation depth from ${block.getHeight()} -> ${parseInt(block.getHeight(), 10) - confirmations}`);
        return Promise.resolve(false);
      }

      if (!b) {
        this._logger.warn(`cannot prune as no start block at confirmation depth ${parseInt(block.getHeight(), 10) - confirmations} found`);
        return Promise.resolve(false);
      }

      let hashesAtHeight = true;
      let compressed = 0;
      while (depth > 0 && b && hashesAtHeight) {
        hashesAtHeight = await this.getBlocksByHeight(parseInt(b.getHeight(), 10), blockchain, {
          cached: false,
          asHeader: true,
          asHashes: true
        });
        if (hashesAtHeight && hashesAtHeight.length > 1 && hashesAtHeight.indexOf(b.getHash()) > -1) {
          for (const hash of hashesAtHeight) {
            if (hash && hash !== b.getHash()) {
              compressed++;
              await this.delBlock(hash, 0, blockchain, { pruning: true });
            }
          }
          b = await this.getBlockByHash(b.getPreviousHash(), blockchain, { asHeader: true, cached: true });
        } else if (hashesAtHeight && hashesAtHeight.length === 0 || hashesAtHeight && hashesAtHeight.indexOf(b.getHash()) < 0) {
          hashesAtHeight = false;
        } else {
          b = await this.getBlockByHash(b.getPreviousHash(), blockchain, { asHeader: true, cached: true });
        }
        depth--;
      }

      // LDL
      this._logger.info(`compressed ${compressed} from ${parseInt(block.getHeight(), 10) - givenConfirmations} remaining: ${depth}`);
      return Promise.resolve(compressed);
    } catch (err) {
      this._logger.error(err);
    }
  }

  /**
   * Attempts to load blocks by range from cache or loads from disk and updates cache
   */
  async getBlocksByRangeCached(start, end, blockchain = 'bc') {
    const response = [];
    let cacheStable = true;
    if (end <= start || end <= start + 1) {
      return response;
    }
    // test the cache integrity
    const latestBlock = await this.get(`${blockchain}.block.latest`);
    if (latestBlock && this.cache.has(`${blockchain}.block.` + latestBlock.getHeight())) {
      const cachedBlock = this.cache.get(`${blockchain}.block.` + latestBlock.getHeight());
      if (cachedBlock.getHeight() !== latestBlock.getHeight()) {
        cacheStable = false;
      }
    }
    if (this.cache.has(`${blockchain}.block.` + start)) {
      const cachedBlock = this.cache.get(`${blockchain}.block.` + start);
      if (cachedBlock.getHeight() !== latestBlock.getHeight()) {
        cacheStable = false;
      }
    }
    for (let i = start; i < end; i++) {
      if (this.cache.has(`${blockchain}.block.` + i) && cacheStable === true) {
        response.push(this.cache.get(`${blockchain}.block.` + i));
      } else {
        const block = await this.get(`${blockchain}.block.` + i);
        if (block === undefined || block === false) {
          break;
        } else {
          response.push(block);
          if (block && block.getHash) {
            this.cache.set(`${blockchain}.block.` + i, block);
          }
        }
      }
    }

    return response;
  }

  // delete all blocks and underlying data associated with them
  async delBlocks(roverName, startHeight, endHeight) {
    for (let i = startHeight; i <= endHeight; i++) {
      const block = await this.getBlockByHeight(i, roverName);
      await this.delBlock(block, 0, roverName);
    }
  }

  async purgeOldBlocks(roverName, startHeight, endHeight, chainConfirmationsNeeded = ROVER_CONFIRMATIONS) {
    let checkBlocks = await this.getBlocksByHeight(startHeight, roverName, { asHeader: true });
    if (checkBlocks === false) checkBlocks = [];

    const nextBlocks = [];
    const confirmationLength = chainConfirmationsNeeded[roverName] || 15;

    for (let i = 1; i <= confirmationLength; i++) {
      let nextBlock = await this.getBlocksByHeight(i + startHeight, roverName, { asHeader: true });
      if (nextBlock === false) nextBlock = [];
      nextBlocks.push(nextBlock);
    }

    for (let i = startHeight; i <= endHeight; i++) {
      const isValid = checkBlocks.map(block => {
        return this.checkIfBlockIsValid(block, nextBlocks, confirmationLength);
      });

      const anyValid = isValid.some(v => {
        return v;
      });

      // if any of the blocks are valid, remove the rest
      if (anyValid) {
        for (let j = 0; j < isValid.length; j++) {
          if (!isValid[j]) {
            // remove invalid block
            await this.delBlock(checkBlocks[j], 0, roverName);
          } else {
            // update main branch
            await this.put(`${roverName}.block.${checkBlocks[j].getHeight()}`, checkBlocks[j]);
          }
        }
      }

      // move on to next block height
      checkBlocks = nextBlocks.shift();

      // TODO: this is probably not needed
      // append next block + confirmationLength to list of blocks to check
      let nextBlock = await this.getBlocksByHeight(i + confirmationLength + 1, roverName, { asHeader: true });
      if (nextBlock === false) nextBlock = [];
      nextBlocks.push(nextBlock);
    }
  }

  checkIfBlockIsValid(validatedBlock, blocksAtHeight, confirmationLength) {
    if (!validatedBlock) {
      // DEBUG
      this._logger.warn('no validated block to evaluate');
      return false;
    }
    // + 3 (one for the current block, one for the start, and one for the end)
    if (blocksAtHeight.length + 10 < confirmationLength) {
      // DEBUG
      // LDL
      debug(`blocks at height (${blocksAtHeight.length}) do not equal confirmation length (${confirmationLength})`);
      return false;
    }
    // DEBUG
    let hashes = [validatedBlock.getHash()];
    let height = parseInt(validatedBlock.getHeight(), 10);
    const firstBlockHeight = parseInt(validatedBlock.getHeight(), 10);
    debug(`starting check with validated block ${height} at hash ${validatedBlock.getHash()} blocksAtHeight: ${blocksAtHeight.length} confirmation length of ${confirmationLength} `);
    for (const blocks of blocksAtHeight) {
      const newHashes = [];
      try {
        // DEBUG
        debug(`loading blocks ${blocks.length}`);
        for (const block of blocks) {
          for (const hash of hashes) {
            if (block.getPreviousHash() === hash && parseInt(block.getHeight(), 10) === height + 1) {
              debug(`push block hash ${block.getHash()}`);
              newHashes.push(block.getHash());
            }
          }
        }
      } catch (e) {
        debug('checkIfBlockIsValid() error: block %O, blocks: %O', validatedBlock.toObject ? validatedBlock.toObject() : validatedBlock, blocks.map(b => b.toObject ? b.toObject() : b));
        // DEBUG
        debug('checkIfBlockIsValid() error: block %O, blocks: %O', validatedBlock.toObject ? validatedBlock.toObject() : validatedBlock, blocks.map(b => b.toObject ? b.toObject() : b));
        this._logger.error(e);
        return false;
      }
      height++;
      if (newHashes.length === 0 && height !== firstBlockHeight) {
        debug(`no new hashes found height ${height}`);
        return false;
      } else if (newHashes.length > 0) {
        hashes = newHashes;
      }
    }
    return true;
  }

  async getMissingBlocks(roverName, startHeight, endHeight, chainConfirmationsNeeded = ROVER_CONFIRMATIONS, backsyncEpoch = 0, opts = { breakIfInvalid: true }) {
    // startHeight < endHeight
    const missingBlocks = [];
    const cacheKey = `${roverName}:${startHeight}:${endHeight}:${chainConfirmationsNeeded}`;

    if (this._completedBlockSegmentsCache.has(cacheKey)) {
      return [];
    }
    let checkBlocks = await this.getBlocksByHeight(startHeight, roverName, { asHeader: true });

    if (checkBlocks === false) {
      checkBlocks = [];
    }

    const chainToConfirm = [];
    // DEBUG
    debug(`confirmations provided ${chainConfirmationsNeeded}`);
    // DEBUG
    const confirmationLength = is(Number, chainConfirmationsNeeded) ? chainConfirmationsNeeded : chainConfirmationsNeeded[roverName];
    // DEBUG
    debug(`confirmations finalized ${confirmationLength}`);
    debug(`getMissingBlocks(): ${checkBlocks.length} checkBlocks for ${roverName} at start height ${startHeight} end height ${endHeight} and chain confirmations ${confirmationLength}`);
    const startHeightBlocks = await this.getBlocksByHeight(startHeight, roverName, { asHeader: true });
    debug(`start height blocks: ${startHeightBlocks.length}`);
    if (startHeightBlocks && startHeightBlocks.length > 0) {
      chainToConfirm.push(startHeightBlocks);
    }

    const conf = endHeight - startHeight > confirmationLength ? confirmationLength : endHeight - startHeight;
    for (let i = 1; i <= conf; i++) {
      let nextBlock = await this.getBlocksByHeight(i + startHeight, roverName, { asHeader: true });
      if (nextBlock) {
        debug(`next block loaded: ${nextBlock.length}`);
      }
      if (nextBlock === false || nextBlock === null) {
        nextBlock = [];
      }
      // append next block only if it is below the minimum backsync epoch
      // if (backsyncEpoch !== 0) {
      //  nextBlock = nextBlock.filter((b) => {
      //    if (Math.floor(b.getTimestamp() / 1000) > backsyncEpoch) {
      //      return b
      //    }
      //  })
      // }
      if (nextBlock.length > 0) {
        chainToConfirm.push(nextBlock);
      }
    }

    // QUESTION: what if the range provided is shorter than the confirmation length of the chain
    let foundInvalidBlock = 0;
    for (let i = startHeight; i < endHeight - confirmationLength; i++) {
      let isValid = false;

      // if (foundInvalidBlock > 0) {
      //  continue
      // }

      // check if at least one of the blocks in this height is valid
      for (let j = 0; j < checkBlocks.length; j++) {
        debug(`checking block: ${checkBlocks[j].getHeight()} chain to confirm length: ${chainToConfirm.length}`);
        if (this.checkIfBlockIsValid(checkBlocks[j], chainToConfirm, confirmationLength)) {
          isValid = true;
        }
      }
      // if none are valid, add to list of missing blocks
      if (!isValid && i !== startHeight) {
        // DEBUG
        debug(`'${roverName} has invalid block'`);
        debug(`${roverName} is missing block ${i}`);
        foundInvalidBlock++;
        missingBlocks.push(i);
      }

      // move on to next block height
      checkBlocks = chainToConfirm.shift() || [];

      // append next block + confirmationLength to list of blocks to check
      let nextBlock = await this.getBlocksByHeight(i + confirmationLength + 1, roverName, { asHeader: true });
      if (nextBlock === false) {
        debug(`second check for next ${roverName} block is false`);
        nextBlock = [];
      }
      if (nextBlock.length > 0) {
        chainToConfirm.push(nextBlock);
      }
    }

    if (missingBlocks.length < 1) {
      this._completedBlockSegmentsCache.set(cacheKey, true);
    } else {
      missingBlocks.push(endHeight);
    }

    return missingBlocks;
  }

  async findClosestBlock(height, roverName, checkLower) {
    let j = 0;
    let block = false;
    while (block === false && Math.abs(j) < 20) {
      block = await this.getBlockByHeight(height + j, roverName, { asHeader: true });
      j = checkLower ? j - 1 : j + 1;
    }
    if (roverName === 'btc') {
      if (!block && checkLower) {
        block = new Block();
        block.setHash(BTC_SYNCHRONIZATION_STOP);
      } else if (!block && !checkLower) {
        block = await this.get('btc.block.latest');
      }
    } else {
      if (!block) {
        block = new Block();
        block.setHeight(height);
      }
    }
    return block;
  }

  async getInvalidBlockIntervals(roverName, chainConstants = ROVER_SECONDS_PER_BLOCK, chainConfirmationsNeeded = ROVER_CONFIRMATIONS) {
    const result = {
      latestBlock: undefined,
      intervals: [],
      synced: true
    };

    const latest = await this.get(`${roverName}.block.latest`);

    if (!latest) {
      result.synced = false;
      return result;
    }

    result.latestBlock = latest;

    // check from latest to (now - 72h) of chain blocks
    const lowestHeightOfDecisivePeriod = Math.round(max(latest.getHeight() - ROVER_RESYNC_PERIOD / chainConstants[roverName], 0)) + 1;

    const missingBlocks = await this.getMissingBlocks(roverName, lowestHeightOfDecisivePeriod, latest.getHeight(), chainConfirmationsNeeded);

    if (missingBlocks.length === 0) {
      return result;
    } else {
      result.synced = false;
      let start = missingBlocks[0];
      let end = missingBlocks[0];
      for (let i = 1; i < missingBlocks.length; i++) {
        const block = missingBlocks[i];
        if (block === end + 1) {
          end = block;
        } else {
          const beforeBlock = await this.findClosestBlock(start, roverName, true);
          const afterBlock = await this.findClosestBlock(end, roverName, false);
          if (!beforeBlock || !afterBlock) {
            this._logger.warn(`couldn't find any blocks before ${start} or after ${end} for ${roverName}`);
          } else {
            result.intervals.push([beforeBlock, afterBlock]);
          }
          start = block;
          end = block;
        }
      }

      const beforeBlock = await this.findClosestBlock(start, roverName, true);
      const afterBlock = await this.findClosestBlock(end, roverName, false);
      if (!beforeBlock || !afterBlock) {
        this._logger.warn(`couldn't find any blocks before ${start} or after ${end} for ${roverName}`);
      } else {
        result.intervals.push([beforeBlock, afterBlock]);
      }
    }
    return result;
  }

  async checkIfBcBlockIsValid(block) {
    const startHeight = block.getHeight();
    const nextBlocks = [];
    let max = 3;
    const latestBlock = await this.get(`${BC_SUPER_COLLIDER}.block.latest`);
    if (block.getHash() == latestBlock.getHash()) return true;
    for (let i = 1; i <= max; i++) {
      let nextBlock = await this.getBlocksByHeight(i + startHeight, 'bc', { asHeader: true, cached: true });
      if (nextBlock === false || nextBlock === null) return false;else {
        nextBlock = nextBlock.filter(nb => {
          return nb.getHash != null;
        });
        nextBlocks.push(nextBlock);
        for (const nb of nextBlock) {
          if (nb.getHash() == latestBlock.getHash()) {
            max = i;
            break;
          }
        }
      }
    }
    return this.checkIfBlockIsValid(block, nextBlocks, max);
  }

  async getRoverSyncReport(blockchain, opts = {
    givenLowestHeight: false,
    givenHighestHeight: false,
    returnRangeIfMissing: false,
    chainState: false
  }) {
    // TODO:  fail early by checking the chainstate first
    // const listSyncCheck = chainState.isBlockchainSynced(blockchain)
    // if (!listSyncCheck) {
    //  return Promise.resolve(false)
    // }
    try {
      if (!ROVER_SECONDS_PER_BLOCK[blockchain]) {
        this._logger.warn(`blockchain not found ${blockchain}`);
        return Promise.resolve({ synced: false, missingBlocks: [] });
      }
      const latestBlock = await this.get(`${blockchain}.block.latest`);
      if (!latestBlock) {
        this._logger.warn(`latest block not available for ${blockchain}`);
        return Promise.resolve({ synced: false, missingBlocks: [] });
      }
      const confirmations = ROVER_CONFIRMATIONS[blockchain];
      const requiredBlockCount = Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[blockchain]);
      const lowestBlockHeight = opts.givenLowestHeight ? opts.givenLowestHeight : max(new BN(latestBlock.getHeight()).sub(new BN(requiredBlockCount)).toNumber(), 0);
      // const lowestBlockHeight = max(new BN(latestBlock.getHeight()).sub(new BN(requiredBlockCount)).toNumber(), 1)
      const highestBlockHeight = max(opts.givenHighestHeight ? opts.givenHighestHeight : new BN(latestBlock.getHeight()).toNumber(), 2);
      debug(`${blockchain} required block count ${requiredBlockCount}, lowest block height ${lowestBlockHeight}, given lowest block height: ${opts.givenLowestHeight}, latest (highest) block height ${highestBlockHeight}, given highest block height: ${opts.givenHighestHeight}`);
      // (roverName: string, startHeight: number, endHeight: number, chainConfirmationsNeeded = ROVER_CONFIRMATIONS, backsyncEpoch: number = 0) { // startHeight < endHeight
      const missingBlocks = await this.getMissingBlocks(blockchain, lowestBlockHeight, highestBlockHeight, confirmations);
      debug(`searching for missing ${blockchain} blocks, minimumBlockHeight: ${lowestBlockHeight} latestBlockHeight: ${latestBlock.getHeight()}, confirmations: ${confirmations}`);
      if (!missingBlocks || missingBlocks.length < 1) {
        debug(`${blockchain} missing 0 blocks <- creates chain: true`);
        return Promise.resolve({ synced: true, missingBlocks: [] });
      }
      debug(`${missingBlocks.length} of ${requiredBlockCount} ${blockchain} blocks to add to multiverse`);

      return Promise.resolve({ synced: false, missingBlocks: missingBlocks });
    } catch (err) {
      this._logger.error(err);
      return Promise.resolve({ synced: false, missingBlocks: [] });
    }
  }

  async isBlockchainSynced(blockchain, opts = {
    givenHighestHeight: false,
    givenLowestHeight: false,
    returnRangeIfMissing: false,
    chainState: false
  }) {
    // TODO:  fail early by checking the chainstate first
    try {
      // if (opts.chainState) {
      //  const latest = opts.chainState.getLatestBlockHeight(blockchain)
      //  const highest = opts.giveHighestHeight ? opts.givenHighestHeight : opts.chainState.getRangeHighestHeight(blockchain)
      //  const lowest = opts.givenLowestHeight ? opts.givenLowestHeight : opts.chainState.getRangeLowestHeight(blockchain)
      //  const chainStateHighest = opts.chainState.getRangeHighestHeight(blockchain)
      //  const chainStateLowest = opts.chainState.getRangeLowestHeight(blockchain)
      //  //if (chainStateLowest !== lowest) {
      //  //  opts.chainState._memory.put(`${blockchain}.range.lowest.height`, lowest)
      //  //}
      //  //if (chainStateHighest !== highest) {
      //  //  opts.chainState._memory.put(`${blockchain}.range.highest.height`, highest)
      //  //}
      //  if (highest && lowest && latest) {
      //    if (new BN(highest).gt(new BN(latest))) {
      //      if (opts.returnRangeIfMissing) {
      //        return Promise.resolve([lowest,highest])
      //      } else {
      //        return Promise.resolve(false)
      //      }
      //    }
      //  } else if (!latest) {
      //    this._logger.warn(`isBlockchainSynced(): chainState -> latest block not available for ${blockchain}`)
      //  } else if (!highest) {
      //    this._logger.warn(`isBlockchainSynced(): chainState -> highest block not available for ${blockchain}`)
      //  } else if (!lowest) {
      //    this._logger.warn(`isBlockchainSynced(): chainState -> lowest block not available for ${blockchain}`)
      //  }
      // }
      const report = await this.getRoverSyncReport(blockchain, opts);
      if (opts.returnRangeIfMissing) {
        return Promise.resolve(report.missingBlocks);
      }
      if (!report || !report.synced) {
        this._logger.info(`${blockchain} synced: false`);
        return Promise.resolve(false);
      }
      this._logger.info(`${blockchain} synced: ${report.synced}`);
      return Promise.resolve(report.synced);
    } catch (err) {
      this._logger.error(err);
      this._logger.info(`${blockchain} synced: false`);
      return Promise.resolve(false);
    }
  }

  /**
   * Returns flags for each chain signaling if chain has a full 72h history from now
   */
  async getDecisivePeriodOfCrossChainBlocksStatus(now, chains = ['btc', 'eth', 'lsk', 'neo', 'wav'], chainConstants = ROVER_SECONDS_PER_BLOCK) {
    const result = {};
    const time = now || Date.now();

    for (const chain of chains) {
      result[chain] = {
        latestBlock: undefined,
        intervals: [],
        synced: true
      };

      const latest = await this.get(`${chain}.block.latest`);

      // we don't have chain latest
      if (!latest) {
        result[chain].synced = false;
        // do not even try to fetch intervals - we still have to wait for missing blocks to sync
        continue;
      }

      result[chain].latestBlock = latest;

      if (latest) {
        if (time - latest.getTimestamp() > chainConstants[chain] * 2) {}
        // check from latest to (now - 72h) of chain blocks
        const lowestHeightOfDecisivePeriod = max(latest.getHeight() - ROVER_RESYNC_PERIOD / chainConstants[chain], 2);
        let lastKnown = latest;
        let previousHadBlock = true;
        const intervals = [];
        for (let i = latest.getHeight() - 1; i >= lowestHeightOfDecisivePeriod; i--) {
          const block = await this.get(`${chain}.block.${i}`);
          if (!block) {
            previousHadBlock = false;
          } else {
            if (!previousHadBlock) {
              intervals.push([block, lastKnown]);
            }
            lastKnown = block;
            previousHadBlock = true;
          }
          // TODO end case
          // TODO test
        }

        result[chain].intervals = intervals;
        result[chain].synced = isEmpty(intervals);
      }
    }

    return result;
  }

  /**
   * Decrement key
   * @param key {string}
   * @param amount {number} [optional]
   */
  async dec(key, amount = 1) {
    const val = await this.get(key);
    if (val === null) {
      return 0;
    }
    const value = parseInt(val, 10); // coerce for Flow
    const inc = value - amount;
    if (inc < 0) {
      return 0;
    }

    await this.put(key, max(0, inc));
    return inc;
  }

  /**
   * Increment key
   * @param key {string}
   * @param amount {number} [optional]
   */
  async inc(key, amount = 1) {
    const val = await this.get(key);
    if (val === null) {
      await this.put(key, 1);
      return Promise.resolve(1);
    }

    const value = parseInt(val, 10); // coerce for Flow
    const inc = new BN(value).add(new BN(amount)).toNumber();
    await this.put(key, inc);
    return Promise.resolve(inc);
  }

  /**
   * Update List
   * @param key {string}
   * @param update {any}
   */
  async updateList(key, update = null) {
    const val = await this.get(key);
    if (update === null) {
      await this.del(key);
      return null;
    }
    if (val === null) {
      await this.put(key, [update]);
      return [update];
    }
    if (Array.isArray(val) === false) {
      throw new Error(`key "${key}" is not a list`);
    }
    try {
      val.push(update);
      await this.put(key, val);
      return val;
    } catch (err) {
      throw new Error('unable to update list');
    }
  }
}
exports.default = PersistenceRocksDb;