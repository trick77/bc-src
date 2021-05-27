'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports._createUnifiedBlock = _createUnifiedBlock;
/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const process = require('process');
const fetch = require('node-fetch');
const { format: utilFormat } = require('util');
const { concat, contains, difference, isEmpty, last, none, pathOr, splitEvery, takeLast, without, xprod, max } = require('ramda');
const { SettleTxCheckReq, RoverMessageType, RoverMessage, RoverIdent, RoverSyncStatus } = require('../../protos/rover_pb');
const { Inventory, Messages, Peer } = require('bitcore-p2p');
const bitcoreLib = require('bitcore-lib');
const LRUCache = require('lru-cache');
const { util: xcpUtils } = require('counterjs');
const long = require('long'); // counterjs uses this internally and we need serialize it as string
const bitcoin = require('bitcoinjs-lib');
const ms = require('ms');
const BN = require('bn.js');
const debug = require('debug')('bcnode:rover:btc:controller');
const debugOuts = require('debug')('bcnode:rover:btc:outs');
const { extractAddressFromInput, extractAddressFromOutput } = require('./util');
const logging = require('../../logger');
const { networks } = require('../../config/networks');
const { errToString } = require('../../helper/error');
const { Block } = require('../../protos/core_pb');
const { RpcClient } = require('../../rpc');
const { Network, isSatoshiPeer } = require('./network');
const roverHelp = require('../helper');
const { createUnifiedBlock } = require('../helper');
const { writeSafely, StandaloneDummyStream, ROVER_SECONDS_PER_BLOCK, ROVER_RESYNC_PERIOD } = require('../utils');
const writeBlock = writeSafely('bcnode:rover:btc:controller');

// monkeypatch Peer.prototype._readMessage - to log error and not fail
// see https://github.com/bitpay/bitcore-p2p/issues/86 and https://github.com/bitpay/bitcore-p2p/issues/102
// don't want to use forked repo
var readMessageOriginal = Peer.prototype._readMessage;
Peer.prototype._readMessage = function () {
  try {
    readMessageOriginal.apply(this, arguments);
  } catch (e) {
    Peer.prototype._onError.apply(this, ['error', e]);
  }
};
// END monkeypatch Peer.prototype._readMessage - to log error and not fail

const NETWORK_TIMEOUT = 7000;
const BLOCK_VERSIONS = [0x20000000, 0x20002000, 0x20640000, 0x2000e000, 0x203de000, 0x20400000, 0x20800000, 0x20ab4000, 0x20c00000, 0x210a6000, 0x2180c000, 0x27ffe000, 0x2aee6000, 0x2ee5a000, 0x2fffc000, 0x2fffe000, 0x20eb6000, 0x2fff4000, 0x2fff8000, 0x320a0000, 0x33a8c000, 0x348a6000, 0x3ad36000, 0x3bae6000, 0x3fff0000, 0x3fffc000, 0x3fffe000, 0x68e34000, 0x7fffe000, 0x7fff0000, 0x7fffc000];

const getUrl = async height => {
  return new Promise((resolve, reject) => {
    const urla = `https://api.blockchair.com/bitcoin/raw/block/${height}?key=A___lyzyF313jW2cXdA4cP8pP4JLcuCw`;
    fetch(urla, { method: "get", headers: { "Content-Type": "application/json" } }).then(response => {
      response.json().then(data => {
        if (data && data.data) {
          const k = Object.keys(data.data)[0];
          const hash = data.data[k].decoded_raw_block.hash;
          resolve(hash);
        }
      });
    }).catch(err => {
      reject(err);
    });
  });
};

const BTC_MAX_FETCH_BLOCKS = process.env.BC__BTC_MAX_FETCH_BLOCKS ? Number.parseInt(process.env.BC__BTC_MAX_FETCH_BLOCKS, 10) : Math.floor(ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK['btc']) + 0;
const BTC_BOOT_BLOCK = process.env.BTC_BOOT_BLOCK;
const BC_BTC_LIVE_BLOCK = process.env.BC_BTC_LIVE_BLOCK === 'true';
const BC_NETWORK = process.env.BC_NETWORK || 'main';
const BTC_NULL_HASH = Buffer.from('0'.repeat(64), 'hex');
const BTC_GENESIS_HASH = true || BC_NETWORK === 'main' ? // eslint-disable-line
'000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f' : '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943';
const BTC_EMB_XCP_ASSET_ID = networks[BC_NETWORK].rovers.btc.embAssetId;
const ASSETS = {
  "1JAuET9GmkADQarX5ZsgHXuHjJzwesfAKg": "PEPEPOPE",
  "1GQhaWqejcGJ4GhQar7SjcCfadxvf5DNBDl": "TRUMPRARE"
};
const ASSET_IDS = Object.keys(ASSETS).reduce((all, i) => {
  all.push(ASSETS[i]);
  return all;
}, []);
let BTC_SYNCHRONIZATION_STOP = exports.BTC_SYNCHRONIZATION_STOP = '000000000000000000074f4aa126a1eb0501e3f67062a8cba2039c1e66827578'; // 683002
let BTC_SYNC_LOWEST_HASH = false;
let BTC_SYNC_LOWEST_HEIGHT = false;
let BTC_SYNC_HIGHEST_HASH = false;
let BTC_SYNC_HIGHEST_HEIGHT = false;

const ROVER_NAME = 'btc';

const BTC_BCH_FORK_INFO = {
  secondBlockAfterFork: { hash: '000000000000000000e512213f7303f72c5f7446e6e295f73c28cb024dd79e34', height: 478560 },
  firstBlockAfterFork: { hash: '00000000000000000019f112ec0a9982926f1258cdcc558dd7c3b7e5dc7fa148', height: 478559 },
  forkBlock: { hash: '0000000000000000011865af4122fe3b144e2cbeea86142e8ff2fb4107352d43', height: 478558 }
};

const INITIAL_RESYNC_STATE = Object.freeze({
  NOT_STARTED: 1,
  REQUESTED: 2,
  RUNNING: 3,
  FINISHED: 4
});

const peerSegments = {};

const decodeBlockHeightFromCoinbase = exports.decodeBlockHeightFromCoinbase = function (tx) {
  if (!tx.isCoinbase()) {
    throw new Error(`TX ${tx.getId()} is not coinbase`);
  }
  const script = tx.ins[0].script;
  const heightBuffer = script.slice(1, 4);
  return bitcoin.script.number.decode(heightBuffer);
};

const logger = logging.getLogger('rover.btc.controller.createUnifiedBlock', false);

async function _createUnifiedBlock(roverRpc, block, isStandalone) {
  const coinbaseTx = bitcoin.Transaction.fromBuffer(block.transactions[0].toBuffer());
  const blockNumber = decodeBlockHeightFromCoinbase(coinbaseTx);

  const headerObj = block.header.toObject();

  const msg = new Block();
  msg.setBlockchain(ROVER_NAME);
  msg.setHash(headerObj.hash);
  msg.setPreviousHash(headerObj.prevHash);
  msg.setTimestamp(block.header.time * 1000);
  msg.setHeight(blockNumber);
  msg.setMerkleRoot(headerObj.merkleRoot);

  debug(`_createUnifiedBlock block h: ${block.header.hash}, he: ${blockNumber}, msg: ${JSON.stringify(msg.toObject())}`);

  const emblemTransactions = [];
  const settlementChecks = [];
  for (let tx of block.transactions) {
    // skip coinbase here, will never be trade settling TX
    if (tx.isCoinbase() || blockNumber < 683232) {
      continue;
    }
    try {
      let xcpTx = xcpUtils.parseTransaction(tx.toString('hex'));

      let { message } = xcpTx;
      // EMB on XCP transaction
      if (message !== undefined) {
        let { sourcePublicKey } = xcpTx;
        let { data: { asset_id: assetId, quantity, destination: dataDestination }, type, destination: txDestination } = message.toJSON();

        if (sourcePublicKey) {
          let isEmbTx = BTC_EMB_XCP_ASSET_ID !== null && assetId === BTC_EMB_XCP_ASSET_ID && (type === 'Send' || type === 'Enhanced Send') && !!sourcePublicKey;
          let ecPair = bitcoin.ECPair.fromPublicKey(sourcePublicKey, bitcoin.networks.bitcoin);
          let from = bitcoin.payments.p2pkh({ pubkey: ecPair.publicKey }).address;

          let value;
          let destination;
          if (txDestination) {
            value = txDestination.amount;
            destination = txDestination.address;
          } else {
            if (!quantity) {
              debug(`unparsable XCP transaction ${tx.id}`);
              continue;
            }
            value = long.fromValue(quantity).toString();
            destination = bitcoin.address.toBase58Check(Buffer.from(dataDestination, 'hex').slice(1), bitcoin.networks.bitcoin.pubKeyHash);
          }

          logger.info(`counter party: ${destination}`);

          if (isEmbTx) {
            let tTx = new MarkedTransaction();
            tTx.setId(ROVER_NAME);
            tTx.setToken('emb'); // TODO maybe contract address?
            tTx.setAddrFrom(from);
            tTx.setAddrTo(destination);
            tTx.setValue(new Uint8Array(new BN(value).toBuffer()));
            tTx.setBlockHeight(msg.getHeight());
            tTx.setIndex(emblemTransactions.length);
            tTx.setHash(tx.id);

            emblemTransactions.push(tTx);
          }
        } else {
          debug(`XCP message %o`, message);
        }
      }
    } catch (err) {
      console.trace(err);
      debug(utilFormat('error while parsing XCP transaction %O', err));
    }

    try {
      const t = bitcoin.Transaction.fromBuffer(tx.toBuffer());
      let inputAddresses = [];
      for (const input of t.ins) {
        try {
          const addr = extractAddressFromInput(input);
          if (addr) {
            inputAddresses.push(addr);
          }
        } catch (e) {
          console.trace(e);
          logger.error(e);
          const msg = utilFormat('ignoring unsupported input %o in tx: %s, txHex: %s', input, tx.id, tx.toBuffer().toString('hex'));
          logger.info(msg);
        }
      }

      let outs = t.outs.map((out, index) => {
        out.index = index;
        return out;
      });
      // debugOuts(outs);
      // get product of all inputs and outputs and check if before settlement height
      const pairs = xprod(inputAddresses, outs);
      let dups = {};
      // debug(`checking ${pairs.length} pairs of input+output for being settled TX`)
      if (pairs && Array.isArray(pairs)) {
        // all combinations of input.address + output.address are being checked, if is before settlement and found, lets add this marked TX
        for (let [from, output] of pairs) {
          try {
            const addrFrom = from;
            const addrTo = extractAddressFromOutput(output);
            const txId = t.getId();
            if (addrTo === null) {
              continue;
            }
            let key = `${addrTo}.${addrFrom}.${txId}:${output.index}`;
            if (!dups[key]) {
              dups[key] = true;
            } else {
              debugOuts(`${txId}:${output.index} for ${addrFrom} is already set`);
              continue;
            }
            const value = new BN(output.value, 10).toBuffer();
            const bridgedChain = ROVER_NAME;
            const blockHeight = msg.getHeight();
            const tokenType = ROVER_NAME;
            const pTx = new SettleTxCheckReq.PossibleTransaction();
            pTx.setAddrFrom(addrFrom);
            pTx.setAddrTo(addrTo);
            pTx.setValue(new Uint8Array(value));
            pTx.setBridgedChain(bridgedChain);
            pTx.setTxId(`${txId}:${output.index}`);
            pTx.setBlockHeight(blockHeight);
            pTx.setTokenType(tokenType);
            // debug(`printing check array to log`)
            // debug(check)
            settlementChecks.push(pTx);
          } catch (e) {
            console.trace(e);
            debug(`unable not parse TX's ${tx.id} input data, e: ${e.message ? e.message : e.toString()}`);
          }
        }
      }
    } catch (e) {
      console.trace(e);
      debug(`unable not parse TX's ${tx.id} input data, e: ${e.message ? e.message : e.toString()}`);
    }
  }
  debug(` block h: ${block.header.hash} settlement checks: ${settlementChecks.length}`);

  try {
    let markedTransactions = [];
    debug(`checking hash ${headerObj.hash}`);
    const checksBatch = splitEvery(100, settlementChecks);

    while (checksBatch.length > 0) {
      const c = checksBatch.shift();
      debugOuts(`processing tx batch ${c.length} ${headerObj.hash}`);
      let newMarkedTransactions = await roverHelp.isBeforeSettleHeight(c, roverRpc, headerObj.hash);
      markedTransactions = newMarkedTransactions !== false ? concat(markedTransactions, newMarkedTransactions) : markedTransactions;
    }

    // if some marked transactions came from settlement check, we have to reindex emblem transactions
    if (markedTransactions.length > 0) {
      for (var i = 0; i < emblemTransactions.length; i++) {
        emblemTransactions[i].setIndex(markedTransactions.length + i);
      }
    }

    markedTransactions = concat(markedTransactions, emblemTransactions);
    msg.setMarkedTxsList(markedTransactions);
    msg.setMarkedTxCount(markedTransactions.length);

    debug(`USED MEM ${Math.round(process.memoryUsage().rss / 1024 / 1024 * 100) / 100}, BTC block processed height = ${msg.getHeight()}`);
    //debug(`msg: ${JSON.stringify(msg.toObject())}`)

    return msg;
  } catch (err) {
    console.trace(err);
    logger.error(utilFormat('error while requesting settlement info, err = %O', err));
  }
}

const randomChoiceMut = function (arr) {
  const index = Math.floor(Math.random() * arr.length);
  const ret = arr[index];
  arr.splice(index, 1);
  return ret;
};

class Controller {

  constructor(isStandalone) {
    this._logger = logging.getLogger(__filename);
    // rover doesn't need complete block history for blockCache or fetchCache, this is managed in chainState
    this._hashTable = {};
    this._blockCache = new LRUCache({ max: 10 });
    this._fetchCache = new LRUCache({ max: 10 });
    this._blocksNumberCache = new LRUCache({ max: 110 });
    this._rpc = new RpcClient();
    if (isStandalone) {
      this._blockStream = new StandaloneDummyStream(__filename);
    } else {
      this._blockStream = this._rpc.rover.collectBlock((err, status) => {
        if (err) {
          this._logger.error(`Error while writing to stream ${err.stack}`);
        }

        this._logger.info(`RPC stream closed, stats: ${status.toObject()}`);
      });
    }
    this._isStandalone = isStandalone;
    this._requestedBlockHashes = [];
    this._blocksToReportAfterHighest = [];
    this._hadQuorumAtLeastOnce = false;
    this._latestBlock = false;
    this._highestBlockSent = false;
    this._initialSync = INITIAL_RESYNC_STATE.NOT_STARTED;
    this._initialSyncHeaderHashes = [];
    this._syncBlockNumbers = [];
    this._blockRangeUpperBound = undefined;
    this._blockRangeLowerBound = undefined;
    this._initialBlocksRequestedFrom = [];
    this._initialSyncPeers = [];
    this._initialBlocksToFetchCount = false;
    this._initialSyncHandler = firstRoveredBlock => {
      debug(`initialResyncHander() tick, initialSync: ${this.initialSync}`);
      // initial sync was requested
      if (this.initialSync === INITIAL_RESYNC_STATE.REQUESTED) {
        debug('initial resync started');
        const lastKnownBlock = this.resyncData.getLatestBlock();
        // we have intervals
        if (!isEmpty(this.resyncData.getIntervalsList())) {
          // eslint-disable-line
          const knownIntervals = this.resyncData.getIntervalsList();

          this._initialBlocksToFetchCount = 0;
          for (const i of knownIntervals) {
            const from = i.getFromBlock();
            const to = i.getToBlock();
            this._initialBlocksToFetchCount += to.getHeight() - from.getHeight() - 1;
            debug(`requesting interval ${from.getHeight()} to: ${to.getHeight()}`);
            this.requestBlock(from, to);
            if (to.getHeight() !== 0) {
              // FIXME wait until first blocks comes
              this._syncBlockNumbers.push([from.getHeight(), to.getHeight()]);
            }
          }

          if (lastKnownBlock && firstRoveredBlock && lastKnownBlock.getHash() !== firstRoveredBlock.getHash()) {
            debug(`requesting interval ${lastKnownBlock.getHeight()} to: ${firstRoveredBlock.getHeight()}`);
            this.requestBlock(lastKnownBlock, firstRoveredBlock);
          }
          debug(`this._initialBlocksToFetchCount %o`, this._initialBlocksToFetchCount);
        } else {
          const start = lastKnownBlock && firstRoveredBlock && lastKnownBlock.getHash() !== firstRoveredBlock.getHash() ? lastKnownBlock.getHash() : BTC_SYNCHRONIZATION_STOP;
          const stop = BTC_NULL_HASH; // i.e. send me 2000 headers
          debug(`initial resync has no intervals, stop is ${lastKnownBlock ? 'last know block' : 'BTC genesis hash'}, requesting starts: [${start}], stop: ${stop.toString('hex')}`);
          const initialSyncBlocks = new Messages().GetHeaders({ starts: [start], stop }); // i.e. I have blocks between lastKnownBlock and stop, send me anything newer
          this._initialSyncPeers = this._sendToRandomPeers(initialSyncBlocks, 2);
          this._initialBlocksToFetchCount = BTC_MAX_FETCH_BLOCKS - 1; // we don't count the top block already fetched
          debug(`this._initialBlocksToFetchCount %o`, this._initialBlocksToFetchCount);
        }
        this.initialSync = INITIAL_RESYNC_STATE.RUNNING;
        this._initialSyncTimeout && clearTimeout(this._initialSyncTimeout);
      }
    };
    this._initialSyncTimeout && clearTimeout(this._initialSyncTimeout);
    this._initialSyncTimeout = setTimeout(this._initialSyncHandler, ms('45s'));

    if (BTC_BOOT_BLOCK && BTC_BOOT_BLOCK.length > 30) {
      this._logger.warn(`BTC_BOOT_BLOCK set as environment variable ${BTC_BOOT_BLOCK}`);
    }
  }

  get network() {
    return this._network;
  }

  get initialSync() {
    return this._initialSync;
  }

  set initialSync(state) {
    debug(`set initialSync() to ${state}`);
    this._initialSync = state;
  }

  get resyncData() {
    return this._resyncData;
  }

  set resyncData(data) {
    this._resyncData = data;
  }

  closestLowestHash(height) {
    if (!height) {
      this._logger.warn(`height not given for closest hash to ${height}, returning with BTC syncronization stop`);
    }
    const lowerBound = max(height - 5000, 1);
    const availableBlockNumbers = Object.keys(this._hashTable);
    let found = false;
    let startHeight = height;

    while (startHeight > lowerBound && !found) {
      if (availableBlockNumbers.indexOf(startHeight) > -1) {
        found = this._hashTable[startHeight];
      } else {
        startHeight--;
      }
    }

    if (!found) {
      this._logger.warn(`could not get closest hash to ${height}, returning with BTC syncronization stop`);
      found = BTC_SYNCHRONIZATION_STOP;
    }

    return found;
  }

  _tryDisconnectPeer(peer) {
    try {
      if (peer && peer.status) {
        peer.disconnect();
      }
    } catch (err) {
      this._logger.debug(`could not disconnect from peer, err: ${errToString(err)}`);
    }

    try {
      this.beforeRemovePeer(peer);
      this.network.removePeer(peer);
    } catch (e) {
      debug(`error while removing peer ${peer.host} from network, err: ${errToString(e)}`);
    }
  }

  beforeRemovePeer(peer) {
    // DEBUG
    this._logger.debug(`beforeRemovePeer: ${peer.host}, ${this._initialBlocksRequestedFrom}`);
    if (this._initialBlocksRequestedFrom.includes(peer.host)) {
      this._initialSyncPeers = this._initialSyncPeers.filter(syncPeer => syncPeer.host !== peer.host);
      if (peerSegments[peer.host]) {
        delete peerSegments[peer.host];
      }
      const [firstHash] = this._requestedBlockHashes;
      const lastHash = last(this._requestedBlockHashes);
      if (!lastHash) {
        this._logger.debug('Request headers array was empty and should not be');
      }
      // const peerMessage = new Messages().GetBlocks({ starts: [firstHash], stop: lastHash })
      const peerMessage = new Messages().GetBlocks({ starts: [firstHash], stop: BTC_NULL_HASH });
      const newPeer = this._initialSyncPeers[Math.floor(Math.random() * this._initialSyncPeers.length)];

      // DEBUG
      if (newPeer && newPeer.host) {
        this._logger.debug(`Selected a new peer: ${newPeer.host} for initial sync, start: ${firstHash}, stop: ${lastHash}`);
        newPeer.sendMessage(peerMessage);
        this._initialBlocksRequestedFrom = this._initialBlocksRequestedFrom.filter(l => l !== peer.host);
        if (!this._initialBlocksRequestedFrom.includes(peer.host)) {
          this._initialBlocksRequestedFrom.push(peer.host);
        }
      }
    }
  }

  init(config) {
    const network = new Network(config);
    this._network = network;

    const pool = this.network.pool;

    process.on('disconnect', () => {
      this._logger.info('Parent exited');
      process.exit();
    });

    // FIXME: This can interfere with global handler
    process.on('uncaughtException', e => {
      this._logger.error(`Uncaught exception: ${errToString(e)}`);
      console.trace(e);
      process.exit(3);
    });

    const rpcStream = this._rpc.rover.join(new RoverIdent(['btc']));
    rpcStream.on('data', message => {
      debug(`rpcStream: Received ${JSON.stringify(message.toObject(), null, 2)}`);
      switch (message.getType()) {// Also could be message.getPayloadCase()
        case RoverMessageType.REQUESTRESYNC:
          this.initialSync = INITIAL_RESYNC_STATE.REQUESTED;
          this.resyncData = message.getResync();
          debug('resync data received: %O', message.getResync().toObject());
          break;

        case RoverMessageType.LATESTBLOCK:
          this._logger.info(`latest block received from manager`);
          break;

        case RoverMessageType.FETCHBLOCK:
          {
            if (this._initialBlocksToFetchCount && this._initialBlocksToFetchCount > 0) {
              this._logger.warn(`fetch request made during active sync... count ${this._initialBlocksToFetchCount}`);
              this._initialBlocksToFetchCount = 0;
              return;
            }
            const payload = message.getFetchBlock();
            this.requestBlock(payload.getFromBlock(), payload.getToBlock());
            break;
          }

        case RoverMessageType.ROVER_BLOCK_RANGE:
          {
            if (this._initialBlocksToFetchCount && this._initialBlocksToFetchCount > 0) {
              this._logger.warn(`range request made during active sync... count log ${this._initialBlocksToFetchCount}`);
              return;
            }

            if (this._syncBlockNumbers.length > 0) {
              this._logger.warn(`sync blocks in queue ${this._syncBlockNumbers.length}`);
              return;
            }

            const data = message.getRoverBlockRange();

            const fromBlock = new Block();
            fromBlock.setHeight(data.getLowestHeight());
            fromBlock.setHash(data.getLowestHash());

            const toBlock = new Block();
            toBlock.setHeight(data.getHighestHeight());
            toBlock.setHash(BTC_NULL_HASH);

            this._logger.info(`open block range request arrived fromBlock: ${fromBlock.getHeight()} ${fromBlock.getHash()} toBlock: ${toBlock.getHeight()}`);
            // always set the upper and lower bound
            //
            this._initialBlocksToFetchCount = data.getHighestHeight() - data.getLowestHeight();
            this.initialSync = INITIAL_RESYNC_STATE.RUNNING;
            this._syncBlockNumbers.push([data.getLowestHeight(), data.getHighestHeight()]);

            this.requestBlock(fromBlock, toBlock);
            break;
          }

        default:
          this._logger.warn(`unknown message type ${message.getType()} make sure you are running the latest version of Block Collider`);
      }
    });
    rpcStream.on('close', () => this._logger.info(`gRPC stream from server closed`));

    pool.on('peerready', function (peer, addr) {
      poolTimeout && clearTimeout(poolTimeout);
      poolTimeout = undefined;

      if (!peer) {
        debug(`unable to conduct handshake with peer ${peer} or ${addr}`);
      } else {
        debug(`connected to pool version: ${peer.version}, subversion: ${peer.subversion}, bestHeight: ${peer.bestHeight}, host: ${peer.host}`);
        const getForkBlock = new Messages().GetHeaders({
          starts: [BTC_BCH_FORK_INFO.forkBlock.hash],
          stop: BTC_BCH_FORK_INFO.secondBlockAfterFork.hash
        });
        peer.sendMessage(getForkBlock);
      }
    });

    pool.on('peerdisconnect', (peer, addr) => {
      debug(`removing peer ${pathOr('', ['ip', 'v4'], addr)}:${addr.port}`);
      this.beforeRemovePeer(peer);
      network.removePeer(peer);
    });

    pool.on('peererror', (peer, err) => {
      debug('peererror, peer %o, err: %O', `${peer.host}:${peer.port}`, err);
      // peer from which initial sync blocks where requested was disconnected, select another one
      this._tryDisconnectPeer(peer);
    });
    pool.on('seederror', err => {
      debug(`seed Error, err: ${errToString(err)}`);
    });
    pool.on('peertimeout', err => {
      debug(`peer timeout, err ${errToString(err)}`);
    });
    pool.on('timeout', err => {
      debug(`timeout, err ${errToString(err)}`);
    });
    pool.on('error', err => {
      debug(`generic pool error, err ${errToString(err)}`);
    });

    // attach peer events
    pool.on('peerinv', (peer, message) => {
      try {
        if (!peer) {
          // console.log(peer)
          return;
        }
        // debug(`peer INV: ${peer.version}, ${peer.subversion}, ${peer.bestHeight}, ${peer.host}`)
        if (peer.subversion !== undefined && isSatoshiPeer(peer)) {
          try {
            let hasHash = true;
            var peerMessage = new Messages().GetData(message.inventory);
            for (const blockInv of message.inventory.filter(i => i.type === Inventory.TYPE.BLOCK)) {
              // hasHash = this._blockCache.has(blockInv.hash.toString('hex').match(/.{1,2}/g).reverse().join(''))
              debug(`getData for block ${blockInv.hash.toString('hex').match(/.{1,2}/g).reverse().join('')} will be sent peer ${peer.host}: ${hasHash}`);
            }
            if (hasHash) {
              setTimeout(() => {
                peer.sendMessage(peerMessage);
              }, 250);
            }
          } catch (err) {
            this._logger.error(err);
            debug('error sending message', err);
            this._tryDisconnectPeer(peer);
          }
        }
      } catch (err) {
        this._logger.error(`Common peerinv handler error: ${errToString(err)}`, err);
      }
    });

    pool.on('peerblock', async (peer, _ref) => {
      try {
        const { block } = _ref;

        if (!peer) {
          console.log(peer);
          return;
        }
        // debug(`PeerBlock: ${peer.version}, ${peer.subversion} ${peer.bestHeight} ${peer.host}, network last block: ${network.bestHeight}`)
        const coinbaseTx = bitcoin.Transaction.fromBuffer(block.transactions[0].toBuffer());
        const blockNumber = decodeBlockHeightFromCoinbase(coinbaseTx);
        debug(`peerblock hash: ${block.header.hash}, btc block height: ${blockNumber}, in _rBH: ${contains(block.header.hash, this._requestedBlockHashes)} bestHeight: ${network.bestHeight}`);

        //if (!network.hasQuorum()) {
        //  debug(`new block received before quorum --> peer count: ${network.discoveredPeers}`)
        //  debug(`peerblock network has no quorum, hash: ${block.header.hash}, h: ${blockNumber}, in _rBH: ${contains(block.header.hash, this._requestedBlockHashes)} bestHeight: ${network.bestHeight}`)
        //  return
        if (!network.bestHeight && this._latestBlock) {
          const updated = network.updateBestHeight();
          // this._logger.info(`updated network best height to ${network.bestHeight}`)
          // if (network.bestHeight < this._latestBlock.getHeight()) {
          //  network.bestHeight = this._latestBlock.getHeight()
          //  this._logger.info(`updated network best height to latest block ${this._latestBlock.getHeight()}`)
          // }
          // if (!updated) {
          //  debug(`updating network best height from ${this._latestBlock.getHeight()}`)
          //  network.bestHeight = this._latestBlock.getHeight()
          // }
        }

        if (network.bestHeight !== undefined) {
          if (!contains(block.header.version, BLOCK_VERSIONS)) {
            debug(`unknown block version 0x${block.header.version.toString(16)} (dec: ${block.header.version}) download the latest Overline client.`);
            // return
          }
          debug(`USED MEM ${Math.round(process.memoryUsage().rss / 1024 / 1024 * 100) / 100}, before _onNewBlock, BTC block processed height = ${blockNumber}`);
          const [isNew, isFromSync, _block] = this._onNewBlock(block);
          if (!block.header.validProofOfWork()) {
            this._logger.warn(`incoming block has invalid difficulty - rejecting the block and restarting rover`);
            process.exit(1);
          }

          if (isNew || this._firstVerifiedHeaderHash === block.header.hash) {
            const unifiedBlock = await createUnifiedBlock(this._isStandalone, block, this._rpc.rover, _createUnifiedBlock);
            const bh = new BN(unifiedBlock.getHeight()).toNumber();

            if (!BTC_SYNC_HIGHEST_HEIGHT) {
              BTC_SYNC_HIGHEST_HEIGHT = bh;
              BTC_SYNC_HIGHEST_HASH = unifiedBlock.getHash();
              BTC_SYNC_LOWEST_HEIGHT = bh;
              BTC_SYNC_LOWEST_HASH = unifiedBlock.getHash();
            } else {
              if (BTC_SYNC_HIGHEST_HEIGHT && bh > BTC_SYNC_HIGHEST_HEIGHT) {
                BTC_SYNC_HIGHEST_HEIGHT = bh;
                BTC_SYNC_HIGHEST_HASH = unifiedBlock.getHash();
              } else if (BTC_SYNC_LOWEST_HEIGHT && bh < BTC_SYNC_LOWEST_HEIGHT) {
                BTC_SYNC_LOWEST_HEIGHT = bh;
                BTC_SYNC_LOWEST_HASH = unifiedBlock.getHash();
              }
            }

            this._logger.info(`rover transporting block : "${unifiedBlock.getHeight()}" : ${unifiedBlock.getHash().slice(0, 21)}`);
            writeBlock(this._blockStream, unifiedBlock);

            debug(`USED MEM ${Math.round(process.memoryUsage().rss / 1024 / 1024 * 100) / 100}, isNew == true, BTC block processed height = ${blockNumber}`);
            debug(`Check before setting bestHeight: isFromSync: ${isFromSync}, bn: ${_block.blockNumber}, bh: ${network.bestHeight}`);
            if (_block.blockNumber > network.bestHeight) {
              network.bestHeight = _block.blockNumber;
            }

            if (isFromSync) {
              if (this._initialBlocksToFetchCount && this._initialBlocksRequestedFrom > 0) {
                this._initialBlocksToFetchCount -= 1;
              }
              debug(`this._initialBlocksToFetchCount %o`, this._initialBlocksToFetchCount);
            }

            if (!this._firstVerifiedHeaderHash) {
              this._firstVerifiedHeaderHash = unifiedBlock.getPreviousHash();
              this._initialSyncTimeout && clearTimeout(this._initialSyncTimeout);
              this._initialSyncTimeout = setTimeout(() => {
                this._initialSyncHandler(unifiedBlock);
              }, ms('15s'));
              debug(`Setting _firstVerifiedHeaderHash to ${this._firstVerifiedHeaderHash}`);
            }
            if (!this._isStandalone) {
              // console.log('writing... ' + unifiedBlock.getHeight() + ' : ' + unifiedBlock.getHash())
              // writeBlock(this._blockStream, unifiedBlock)
              this.setLocalLatestBlock(unifiedBlock);

              if (this._blockRangeLowerBound && this._blockRangeLowerBound.height === unifiedBlock.getHeight()) {
                this._blockRangeLowerBound.hash = unifiedBlock.getHash();
                this._blockRangeLowerBound.timestamp = Math.floor(Date.now() * 0.001);
                debug(`discovered lower bound hash for ${blockNumber} <- ${unifiedBlock.getHash()}`);
              } else if (this._blockRangeUpperBound && this._blockRangeUpperBound.height === unifiedBlock.getHeight()) {
                debug(`discovered upper bound hash for ${blockNumber} <- ${unifiedBlock.getHash()}`);
                this._blockRangeUpperBound.hash = unifiedBlock.getHash();
                this._blockRangeUpperBound.timestamp = Math.floor(Date.now() * 0.001);
              }

              debug(`Requested block hashes: ${this._requestedBlockHashes.length > 2 ? this._requestedBlockHashes.length + ', first: ' + this._requestedBlockHashes[0] : this._requestedBlockHashes}`);
              debug(`initialSync: ${this.initialSync}`);
              if (this.initialSync === INITIAL_RESYNC_STATE.RUNNING && this._initialBlocksToFetchCount && this._latestBlock && new BN(this._latestBlock.getHeight()).gte(new BN(network.bestHeight))) {
                this.initialSync = INITIAL_RESYNC_STATE.FINISHED;
                this._rpc.rover.reportSyncStatus(new RoverSyncStatus(['btc', true]), (err, response) => {
                  if (err) {
                    logging.getLogger(__filename).warn(`Could not report rover sync status:true, err: ${err.toString()}`);
                  } else {
                    logging.getLogger(__filename).info(`Rover sync status:true reported succesfully`);
                  }
                  this.setBlockRange();
                });
              } else if (this._latestBlock && this._latestBlock.getHeight() >= network.bestHeight && unifiedBlock.getHeight() === this._latestBlock.getHeight()) {
                debug(`latest height ${this._latestBlock.getHeight()} is greater than or equal to network height ${network.bestHeight}`);
                this.initialSync = INITIAL_RESYNC_STATE.FINISHED;
                this._rpc.rover.reportSyncStatus(new RoverSyncStatus(['btc', true]), (err, response) => {
                  if (err) {
                    logging.getLogger(__filename).warn(`Could not report rover sync status:true, err: ${err.toString()}`);
                  } else {
                    logging.getLogger(__filename).info(`Rover sync status:true reported succesfully`);
                  }
                  this.setBlockRange();
                });
                this.setBlockRange();
              }
            } else {
              debug(`collected new BTC block: ${unifiedBlock.toObject()}`);
              // this.setBlockRange()
            }
          } else {
            debug(`peerblock ignored block ${blockNumber} isNew: ${isNew}, isFromSync: ${isFromSync}`);
          }
        } else if (peer !== undefined && peer.status !== undefined && peer.hash !== undefined && pool._connectedPeers[peer.hash] !== undefined) {
          debug(`peerblock FAILED1 hash: ${block.header.hash}`);
          try {
            pool._removeConnectedPeer(peer);
          } catch (err) {
            this._logger.error('Error removing peer', err);
          }
        } else {
          this._logger.warn(`Network best height not set`);
          if (!block.header.validProofOfWork()) {
            this._logger.warn(`incoming block has invalid difficulty - rejecting the block and restarting rover`);
            process.exit(1);
          } else {
            const unifiedBlock = await createUnifiedBlock(this._isStandalone, block, this._rpc.rover, _createUnifiedBlock);
            writeBlock(this._blockStream, unifiedBlock);
          }
        }
      } catch (err) {
        this._logger.error(`error transporting block: ${err.message}`);
      }
    });

    pool.on('peerheaders', (peer, msg) => {
      const headers = msg.headers.map(({ hash, prevHash }) => ({ hash, prevHash }));
      debug(`peerheaders start peer: ${peer.host}, hhs: ${headers.length}, _requestedBlockHashes: %o`, this._requestedBlockHashes);

      // do the peer verification dance first
      if (!network.hasPeer(peer)) {
        debug(`unknown peer ${peer.host} - beginning evaluation`);
        let isBTCPeer = headers.filter(h => h.hash === BTC_BCH_FORK_INFO.firstBlockAfterFork.hash).length > 0;
        if (!isBTCPeer) {
          debug(`Disconnecting peer ${peer.host} - probably not a BTC peer`);
          this._tryDisconnectPeer(peer);
          return;
        }

        if (network.hasQuorum()) {
          try {
            network.addPeer(peer);
            network.updateBestHeight();

            if (!this._hadQuorumAtLeastOnce) {
              this._hadQuorumAtLeastOnce = true;

              // TODO fix fetching of the boot block - now broken because of for headers fetching IMHO
              if (BTC_BOOT_BLOCK) {
                debug(`Fetching latest block (h: ${BTC_BOOT_BLOCK}) from network`);
                // see https://en.bitcoin.it/wiki/Protocol_documentation#getblocks
                const getLatestBlock = new Messages().GetBlocks({ starts: [BTC_BOOT_BLOCK], stop: BTC_NULL_HASH });
                this._sendToRandomPeers(getLatestBlock, 2);
              }
            }
          } catch (err) {
            this._logger.warn('Error in peerheaders cb', err);
          }
        } else if (!network.hasQuorum() && isSatoshiPeer(peer)) {
          debug(`Network doesn't have quorum and peer ${peer.host} is a satoshi peer - adding`);
          try {
            network.addPeer(peer);
            // network.updateBestHeight()
          } catch (err) {
            if (peer !== undefined && peer.status !== undefined) {
              peer.disconnect();
            }
          }
        } else {
          this._tryDisconnectPeer(peer);
        }
        return;
      }

      debug(`peer ${peer.host} is known to network, received ${headers.length} headers`);

      // store all the header hashes so that we're able to get the interval till the tip of the chain
      // difference is here to only store missing items - these will arrive from multiple peers
      const store = difference(headers, this._initialSyncHeaderHashes);
      debug(`storing ${store.length} headers - this was the difference between already known and received`);
      this._initialSyncHeaderHashes = concat(this._initialSyncHeaderHashes, store);

      // if we received 2000 headers - we need to loop again using starts: headers.last, stop: zeroes, until the number is smaller
      if (headers.length === 2000) {
        const lastReceivedHeader = last(this._initialSyncHeaderHashes);
        if (!lastReceivedHeader) {
          debug('Received headers array was empty and should not be');
        }
        const start = lastReceivedHeader.hash;
        // console.log(lastReceivedHeader)
        const stop = BTC_NULL_HASH; // i.e. send me as much headers as you have (protocol max is 2000 headers)
        debug(`initial resync has no intervals, continue traversal from start: [${start}], stop: ${stop.toString('hex')}`);
        if (!peerSegments[peer.host]) {
          peerSegments[peer.host] = 1;
        } else {
          peerSegments[peer.host]++;
        }
        debug(`traversing segment ${peerSegments[peer.host]} from ${start}`);
        const initialSyncBlocks = new Messages().GetHeaders({ starts: [start], stop }); // i.e. I have blocks between last received header hash and stop, send me anything newer
        setTimeout(() => peer.sendMessage(initialSyncBlocks), ms('100')); // send only to peer which returned these or else first interval would be request from 10, second from 10^2, third from 10^3...
        return;
      }

      let requestHeaders = this._initialSyncHeaderHashes;

      // we received less than 2000 headers during initial sync - now it's time to request BTC_MAX_FETCH_BLOCKS <- wrong
      //
      if (this._initialSyncHeaderHashes.length > BTC_MAX_FETCH_BLOCKS) {
        debug(`Limiting number of blocks fetch to ${BTC_MAX_FETCH_BLOCKS} even though ${this._initialSyncHeaderHashes.length} stored`);
        requestHeaders = takeLast(BTC_MAX_FETCH_BLOCKS, this._initialSyncHeaderHashes);
      }

      // Store hashes to requested hashes to be able to track and save arriving blocks with height < bestHeight
      for (const h of requestHeaders) {
        // debug(`Is header ${h.hash} already requested?`)
        if (!contains(h.hash, this._requestedBlockHashes)) {
          debug(`requesting block ${h.hash}`);
          this._requestedBlockHashes.push(h.hash);
        }
      }

      const [firstHeader] = requestHeaders;
      const lastHeader = last(requestHeaders);
      if (!lastHeader) {
        // DEBUG
        debug('Received headers array cannot be empty and should not be');
      }
      // const peerMessage = new Messages().GetBlocks({ starts: [firstHeader.prevHash], stop: lastHeader.hash })
      const peerMessage = new Messages().GetBlocks({ starts: [firstHeader.hash], stop: BTC_NULL_HASH });
      debug(`peerheaders before send of GetBlocks: ibrf: ${peer.host}`);
      debug(`Sending blocks request to peer ${peer.host}, start: ${firstHeader.hash}, stop: ${BTC_NULL_HASH}`);
      peer.sendMessage(peerMessage);
      if (!this._initialBlocksRequestedFrom.includes(peer.host)) {
        this._initialBlocksRequestedFrom.push(peer.host);
      }

      this._initialSyncHeaderHashes = [];
    });

    let poolTimeout = setTimeout(function () {
      network.disconnect();
      network.connect();
    }, NETWORK_TIMEOUT);

    network.connect();

    setInterval(() => {
      if (this._latestBlock) {
        debug(`peer count pool: ${pool.numberConnected()} dp: ${network.discoveredPeers}, sp: ${network.satoshiPeers}, q: ${network.hasQuorum()}, bh: ${network.bestHeight}, lb: ${this._latestBlock.getHeight()}`);
      } else {
        debug(`peer count pool: ${pool.numberConnected()} dp: ${network.discoveredPeers}, sp: ${network.satoshiPeers}, q: ${network.hasQuorum()}, bh: ${network.bestHeight}`);
      }
      // if (this.initialSync === INITIAL_RESYNC_STATE.RUNNING && this._initialBlocksToFetchCount && this._latestBlock && new BN(this._latestBlock.getHeight()).gte(new BN(network.bestHeight))) {
      //  this.initialSync = INITIAL_RESYNC_STATE.FINISHED
      //  this._rpc.rover.reportSyncStatus(new RoverSyncStatus(['btc', true]), (err, response) => {
      //    if (err) {
      //      logging.getLogger(__filename).warn(`Could not report rover sync status:true, err: ${err.toString()}`)
      //    } else {
      //      logging.getLogger(__filename).info(`Rover sync status:true reported succesfully`)
      //    }
      //    this.setBlockRange()
      //  })
      // }
      this._logger.info(`syncing: ${this._initialSync}, blocks to fetch: ${this._initialBlocksToFetchCount}, latest: ${network.bestHeight}, lower bound: ${BTC_SYNC_LOWEST_HEIGHT}, upper bound: ${BTC_SYNC_HIGHEST_HEIGHT}`);
      // const timer = Math.floor(Date.now() * 0.001) - 125
      // if (this._blockRangeLowerBound && this._blockRangeUpperBound && this._blockRangeUpperBound.timestamp < timer && this._blockRangeLowerBound.timestamp < timer && this._blockRangeLowerBound.hash && this._blockRangeUpperBound.hash) {
      //  this._blockRangeLowerBound.timestamp = Math.floor(Date.now() * 0.001)
      //  this._blockRangeUpperBound.timestamp = Math.floor(Date.now() * 0.001)

      //  const fromBlock = new Block()
      //  fromBlock.setHash(this._blockRangeLowerBound.hash)
      //  fromBlock.setHeight(2)
      //  const toBlock = new Block()
      //  toBlock.setHash(this._blockRangeUpperBound.hash)
      //  toBlock.setHeight(2)

      //  this.requestBlock(fromBlock, toBlock)
      // } else if (this._latestBlock && this._blockRangeUpperBound && new BN(this._blockRangeUpperBound.height).gt(new BN(this._latestBlock.getHeight()))) {
      //  this._logger.info(`loading latest block ${this._latestBlock.getHeight()} hash: ${this._latestBlock.getHash()}`)
      //  const toBlock = new Block()
      //  toBlock.setPreviousHash(this._latestBlock.hash)
      //  toBlock.setHash(BTC_NULL_HASH)
      //  toBlock.setHeight(new BN(this._latestBlock.getHeight()).add(new BN(1)).toNumber())
      //  if (this._latestBlock) {
      //    this.requestBlock(this._latestBlock, toBlock)
      //  }
      // }
    }, ms('24s'));
  }

  _onNewBlock(block) {
    const { hash } = block.header;

    if (this._latestBlock) {
      if (!this.network.bestHeight) {
        this.network.bestHeight = this._latestBlock.getHeight();
      }
    }

    const coinbaseTx = bitcoin.Transaction.fromBuffer(block.transactions[0].toBuffer());
    const blockNumber = decodeBlockHeightFromCoinbase(coinbaseTx);
    let checkCache = true;
    // check if blockNumber >= last seen block or block hash was requested by fetch_block method
    if (this._blockRangeUpperBound) {
      // if the hash has not been set and this is the height set the value
      if (this._blockRangeUpperBound.height === blockNumber) {
        debug(`discovered upper bound hash for ${blockNumber} <- ${hash}`);
        this._blockRangeUpperBound.hash = hash;
        checkCache = false;
      }
    }

    if (this._blockRangeLowerBound && this._blockRangeLowerBound.height) {
      // if the hash has not been set and this is the height set the value
      // if (this._blockRangeLowerBound.height < blockNumber) {
      //  this._logger.info(`assigning new lower bound hash for ${blockNumber} <- ${hash}`)
      //  this._blockRangeLowerBound.hash = hash
      //  checkCache = false
      /// / if the block found is above the lowest hash by one step to it
      // } else if (this._blockRangeLowerBound.height === (blockNumber - 1)) {
      //  this._logger.info(`discovered lower bound hash for ${blockNumber} <- ${hash}`)
      //  this._blockRangeLowerBound.height = blockNumber
      //  this._blockRangeLowerBound.hash = hash
      //  checkCache = false
      /// / if the block found is the lower bound set the hash
      // } else if (this._blockRangeLowerBound.height === blockNumber) {
      //  this._blockRangeLowerBound.hash = hash
      //  checkCache = false
      // }
    }

    this._hashTable[blockNumber] = block.header.hash;
    checkCache = this._fetchCache.has(block.header.hash);

    // check first if the range is being requested
    if (this._fetchCache.has(blockNumber)) {
      // remove the request as the block has arrived
      this._fetchCache.del(blockNumber);
      this._blockCache.set(hash, true);
      this._blocksNumberCache.set(blockNumber, true);
      debug(`force request range block ${blockNumber} with hash ${hash} and removing from requested block hashes`);
      // this._requestedBlockHashes.push(hash)
      block.blockNumber = blockNumber;
      if (contains(hash, this._requestedBlockHashes)) {
        debug(`Fetched requested block ${blockNumber}, h: ${hash}`);
        this._requestedBlockHashes = without([hash], this._requestedBlockHashes);
        isFromSync = true;
      }
      return [true, true, block];
    } else if (checkCache && this._blockCache.has(hash)) {
      debug(`_onNewBlock cache has hash: ${block.header.hash}, h: ${blockNumber}, in _rBH: ${contains(block.header.hash, this._requestedBlockHashes)}`);
      return [false, false, block];
    }

    this._blockCache.set(hash, true);
    this._fetchCache.set(block.header.hash, true);

    debug(`_onNewBlock caching hash: ${block.header.hash}, h: ${blockNumber}, in _rBH: ${contains(block.header.hash, this._requestedBlockHashes)}`);

    const hasBounds = this._blockRangeUpperBound && this._blockRangeLowerBound && this._blockRangeLowerBound.height && this._blockRangeUpperBound.height;
    if (blockNumber < this.network.bestHeight && !contains(hash, this._requestedBlockHashes) && none(([from, to]) => blockNumber >= from && blockNumber <= to, this._syncBlockNumbers)) {
      // if the block has bounds determine if it is within them
      if (hasBounds && this._initialBlocksToFetchCount === 0) {
        if (blockNumber < this._blockRangeLowerBound.height || blockNumber > this._blockRangeUpperBound.height) {
          debug(`Block ${blockNumber} received but < best height: ${this.network.bestHeight}`);
          return [true, false, block];
        }
      } else {
        debug(`failed validity check for hash: ${hash}`, this._requestedBlockHashes);
        debug(`block ${blockNumber} would be ignored height: ${this.network.bestHeight}`);
        return [true, true, block];
      }
    }

    if (this._blocksNumberCache.has(blockNumber) === true) {
      this._logger.info('resolving orphan:  ' + blockNumber + ' ' + hash);
    } else {
      this._blocksNumberCache.set(blockNumber, true);
      debug(`_onNewBlock caching blockNumber: ${block.header.hash}, h: ${blockNumber}, in _rBH: ${contains(block.header.hash, this._requestedBlockHashes)}`);
    }

    let isFromSync = this._initialBlocksToFetchCount === 0 ? true : false;
    if (contains(hash, this._requestedBlockHashes)) {
      debug(`Fetched requested block ${blockNumber}, h: ${hash}`);
      this._requestedBlockHashes = without([hash], this._requestedBlockHashes);
      isFromSync = true;
    }

    block.blockNumber = blockNumber;

    //return [true, isFromSync, block]
    return [true, true, block];
  }

  setLocalLatestBlock(block) {
    if (!this._latestBlock) {
      this._latestBlock = block;
      return;
    }

    const currentHeight = this._latestBlock.getHeight();
    const nextHeight = block.getHeight();

    if (new BN(currentHeight).lt(new BN(nextHeight)) === true) {
      this._latestBlock = block;
    }
  }

  setBlockRange() {
    if (this._blockRangeLowerBound && this._blockRangeLowerBound && this._blockRangeLowerBound.hash && this._blockRangeUpperBound.hash) {
      debug(`reporting block range upper hash ${this._blockRangeUpperBound.hash} lower hash ${this._blockRangeLowerBound.hash}`);
      const payload = new RoverMessage.RoverBlockRange(['btc', this._blockRangeUpperBound.height, this._blockRangeLowerBound.height, this._blockRangeUpperBound.hash, this._blockRangeLowerBound.hash]);
      this._rpc.rover.reportBlockRange(payload, (_, res) => {
        this._logger.debug(`block range reported successfully`);
      });
      // unsset the bounds allowing the bounds to be changed
      this._blockRangeUpperBound = undefined;
      this._blockRangeLowerBound = undefined;
    }
  }

  requestBlock(fromBlock, toBlock, quorumFraction = 3, startHash = false) {
    // now can be just a consecutive from-to hashes
    let fromHash = fromBlock.getHash();
    const fromHeight = new BN(fromBlock.getHeight()).toNumber();

    this._fetchCache.set(fromHeight, true);
    // sync block numbers possible array
    if (startHash) {
      fromHash = startHash;
    }

    if (!fromHash) {
      fromHash = this.closestLowestHash(fromHeight);

      if (fromHash === BTC_SYNCHRONIZATION_STOP && BC_BTC_LIVE_BLOCK) {
        return getUrl(fromHeight).then(hash => {
          this.requestBlock(fromBlock, toBlock, quorumFraction, hash);
        });
      }
    }

    if (!fromHash || fromHash.length < 10) {
      this._logger.warn(utilFormat('requestBlock(): malformed hash provided fromHash=%s', fromHash));
      return;
    }

    if (this._blockRangeLowerBound) {
      debug(`requestBlock() start - from ${fromBlock.getHash()} blockRangeLowerBound: ${this._blockRangeLowerBound.height} blockRangeUpperBound: ${this._blockRangeUpperBound.height}`);
    } else {
      debug(`requestBlock() start - from ${fromBlock.getHash()}`);
    }

    if (!this.network.bestHeight) {
      debug(`ignoring requesst block range ${fromBlock.getHeight()} -> ${toBlock.getHeight()}`);
      return;
    }

    debug(`requestBlock(): from ${fromHeight} ${fromHash}`);
    // if (toBlock.getPreviousHash() === fromBlock.getHash()) {
    //  // we have nothing to do here, consecutive blocks
    //  debug(`nothing to do, sent blocks are consecutive`)
    //  return
    // }

    if (fromBlock.getHash() !== BTC_NULL_HASH) {
      if (!this._blockRangeLowerBound) {
        this._blockRangeLowerBound = {
          hash: fromBlock.getHash(),
          height: new BN(fromBlock.getHeight()).toNumber(),
          timestamp: Math.floor(Date.now() * 0.001)
        };
        debug(`updated range <- seeking ${this._blockRangeLowerBound.height}`);
      }
      if (!this._blockRangeUpperBound) {
        this._blockRangeUpperBound = {
          hash: false,
          height: new BN(toBlock.getHeight()).toNumber(),
          timestamp: Math.floor(Date.now() * 0.001)
          // DEBUG
        };debug(`updated range <- seeking ${this._blockRangeUpperBound.height}`);
      }
    }

    // if (toBlock.getHeight && (toBlock.getHeight() - fromBlock.getHeight()) > BTC_MAX_FETCH_BLOCKS) {
    //  toBlock = toBlock.cloneMessage()
    //  toBlock.setHash(BTC_NULL_HASH)
    //  this._logger.warn(`Requested ${toBlock.getHeight() - fromBlock.getHeight()} (more than BTC_MAX_FETCH_BLOCKS ${BTC_MAX_FETCH_BLOCKS}) setting to hash to BTC_NULL_HASH`)
    // }

    // request headers first to have a whole list of headers to be fetched
    // with this list we are able to track if requested blocks where fetched
    //const lowerNotSet = !this._blockRangeLowerBound.height || parseInt(fromBlock.getHeight(), 10) !== this._blockRangeLowerBound.height
    //if (lowerNotSet) {
    //  this._blockRangeLowerBound.height = parseInt(fromBlock.getHeight(), 10)
    //  this._blockRangeLowerBound.hash = fromBlock.getHash()

    for (let i = parseInt(fromBlock.getHeight(), 10); i <= parseInt(toBlock.getHeight(), 10); i++) {
      debug(`setting block height in fetch at height ${i} and removing from blocks number cache`);
      this._fetchCache.set(i, true);
      this._blocksNumberCache.del(i);
    }
    // MMM
    this._logger.info(`requestBlock() requesting headers from ${fromBlock.getHash()}`);
    const peerMessage = new Messages().GetBlocks({ starts: [fromHash], stop: BTC_NULL_HASH });
    //const peerMessage = new Messages().GetHeaders({starts: [fromHash], stop: BTC_NULL_HASH})
    this._sendToRandomPeers(peerMessage, quorumFraction);
    //}
  }

  _sendToRandomPeers(message, quorumFraction = 2) {
    // returns array of hosts
    const peers = [].concat(Object.values(this.network.pool._connectedPeers));

    // select random floor(maximumPeers / quorumFraction)
    const askPeers = [];
    const numChosen = Math.floor(peers.length / quorumFraction);
    for (var i = 0; i < numChosen; i++) {
      askPeers.push(randomChoiceMut(peers));
    }

    // DEBUG
    debug(`sending message ${message.command} to ${numChosen} peers`);

    const askedPeers = [];
    let m = 0;
    while (askPeers.length) {
      m++;
      const peer = askPeers.shift();
      askedPeers.push(peer);
      setTimeout(() => {
        peer.sendMessage(message);
      }, 30 * m);
    }
    // for (let peer of askPeers) {
    //  peer.sendMessage(message)
    // }

    return askedPeers;
  }

  close() {
    this._logger.info(`close event trigger network shutdown -> scheduling restart...`);
    this.network && this.network.disconnect();
    this._initialSyncTimeout && clearTimeout(this._initialSyncTimeout);
    this._blockStream.end();
    process.exit();
  }
}
exports.default = Controller;