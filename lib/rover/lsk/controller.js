'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports._createUnifiedBlock = _createUnifiedBlock;
/**
 * Copyright (c) 2017-present, Overline developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const LRUCache = require('lru-cache');
const liskCryptography = require('@liskhq/lisk-cryptography');
const { concat, flatten, isEmpty, merge, max, min } = require('ramda');
const BN = require('bn.js');
const debugFactory = require('debug');
const debug = debugFactory('bcnode:rover:lsk:controller');

const { Block, MarkedTransaction } = require('@overline/proto/proto/core_pb');
const { SettleTxCheckReq, RoverMessage, RoverMessageType, RoverIdent, RoverSyncStatus } = require('@overline/proto/proto/rover_pb');
const logging = require('../../logger');
const { networks } = require('../../config/networks');
const { RpcClient } = require('../../rpc');
const { blake2b } = require('../../utils/crypto');
const { parseBoolean } = require('../../utils/config');
const { FetchIntervalStore, IntervalLimit } = require('./util');
const { createUnifiedBlock } = require('../helper');
const roverHelp = require('../helper');
const { StandaloneDummyStream, ROVER_RESYNC_PERIOD, ROVER_SECONDS_PER_BLOCK, writeSafely, batchProcess } = require('../utils');
const { rangeStep } = require('../../utils/ramda');
const { createNetwork } = require('./network');
const writeBlock = writeSafely('bcnode:rover:lsk:controller');

// const BC_NETWORK = process.env.BC_NETWORK || 'main'
const LSK_MAX_FETCH_BLOCKS = exports.LSK_MAX_FETCH_BLOCKS = 9;
const BC_NETWORK = 'main';
const LSK_EMB_DESIGNATED_WALLET_PUBKEY = networks[process.env.BC_NETWORK || 'main'].rovers.lsk.embAssetId;
const LSK_GENESIS_BLOCKID_HEX = '7b58474daad00bf51a4bd75e8b59b679a2c11b13356ff3d8b6e0cc6fed4e8477';
const LSK_GENESIS_HEIGHT = 16270294;
const ROVER_NAME = 'lsk';
const BC_MINER_BOOT = parseBoolean(process.env.BC_MINER_BOOT); // initialize new super collider

const getMerkleRoot = block => {
  if (!block.transactions || block.transactions.length === 0) {
    return blake2b(block.header.signature);
  }

  const txs = block.transactions.map(tx => tx.id);
  if (!txs) {
    return false;
  }
  return txs.reduce((acc, el) => blake2b(acc + el), '');
};

const logger = logging.getLogger('rover.lsk.controller.createUnifiedBlock', false);
async function _createUnifiedBlock(roverRpc, block, isStandalone) {
  // TODO specify block type

  try {
    const merkleRoot = getMerkleRoot(block);
    if (!merkleRoot) {
      throw new Error(`unable to create block <- malformed data`);
    }
    if (!block.transactions) {
      debug(`given block has no transactions`);
      return false;
    }

    const { header, transactions } = block;

    delete header.asset;
    delete header.id;

    const obj = {
      blockNumber: header.height,
      prevHash: header.previousBlockID.toString('hex'),
      blockHash: header.blockID.toString('hex'),
      root: merkleRoot,
      blockSignature: header.signature,
      timestamp: parseInt(header.timestamp, 10) * 1000,
      version: header.version,
      transactions
    };

    debug({ block });
    const msg = new Block();
    msg.setBlockchain(ROVER_NAME);
    msg.setHash(obj.blockHash);
    msg.setPreviousHash(obj.prevHash);
    msg.setTimestamp(obj.timestamp);
    msg.setHeight(obj.blockNumber);
    msg.setMerkleRoot(obj.root);

    debug(`lsk controller() _createUnifiedBlock(): processing height ${msg.getHeight()}`);

    const emblemTransactions = [];
    const settlementChecks = [];
    for (let tx of transactions) {
      // for type docs see https://lisk.io/documentation/lisk-protocol/transactions
      let isEmbTx = LSK_EMB_DESIGNATED_WALLET_PUBKEY !== null && tx.senderPublicKey.toString('hex') === LSK_EMB_DESIGNATED_WALLET_PUBKEY;

      // see https://github.com/LiskHQ/lips/blob/master/proposals/lip-0028.md and https://github.com/LiskHQ/lips/blob/master/proposals/lip-0012.md
      const addrFrom = liskCryptography.getBase32AddressFromPublicKey(tx.senderPublicKey);
      const addrTo = liskCryptography.getBase32AddressFromAddress(tx.asset.recipientAddress);
      const value = new BN(tx.asset.amount).toBuffer();
      const bridgedChain = ROVER_NAME;
      const txId = tx.id.toString('hex');
      const blockHeight = msg.getHeight();
      const tokenType = isEmbTx ? 'emb' : ROVER_NAME;

      if (isEmbTx) {
        let ttx = new MarkedTransaction();
        ttx.setId(bridgedChain);
        ttx.setToken(tokenType);
        ttx.setAddrFrom(addrFrom);
        ttx.setAddrTo(addrTo);
        // FIXME value (tx.asset.amount) is in beddows now - fix that here to use m-lisk / beddows again
        ttx.setValue(new Uint8Array(value)); // TODO use denominator for m-lisk

        ttx.setBlockHeight(blockHeight);
        ttx.setIndex(emblemTransactions.length);
        ttx.setHash(txId);

        emblemTransactions.push(ttx);
      } else {
        const pTx = new SettleTxCheckReq.PossibleTransaction();
        pTx.setAddrFrom(addrFrom);
        pTx.setAddrTo(addrTo);
        pTx.setValue(new Uint8Array(value));
        pTx.setBridgedChain(bridgedChain);
        pTx.setTxId(txId);
        pTx.setBlockHeight(blockHeight);
        pTx.setTokenType(tokenType);
        settlementChecks.push(pTx);
        debug('addrFrom = %s addrTo = %s value = %d bridgedChain = %s txId = %s blockHeight = %d tokenType = %s', addrFrom, addrTo, value, bridgedChain, txId, blockHeight, tokenType);
      }
    }

    try {
      debug(`checking settlements for ${obj.blockNumber}`);
      let markedTransactions = settlementChecks && settlementChecks.length > 0 ? await roverHelp.isBeforeSettleHeight(settlementChecks, roverRpc, obj.blockHash, 'lsk') : [];

      // if some marked transactions came from settlement check, we have to reindex emblem transactions
      if (markedTransactions && markedTransactions.length > 0) {
        for (var i = 0; i < emblemTransactions.length; i++) {
          emblemTransactions[i].setIndex(markedTransactions.length + i);
        }
      }

      markedTransactions = concat(markedTransactions, emblemTransactions);

      debug(`checking queued marked txs for ${obj.blockNumber}`);
      const queuedMarkedTransactions = markedTransactions.length > 0 ? await roverHelp.getQueuedMarkedTxs(markedTransactions, roverRpc, obj.blockHash, 'lsk') : [];

      msg.setMarkedTxsList(markedTransactions);
      msg.setMarkedTxCount(markedTransactions.length);

      return msg;
    } catch (e) {
      debug('error in isBeforeSettleHeight or getQueuedMarkedTxs, e = %O', e);
    }
  } catch (err) {
    debug(err);
  }
}

const firstHardforkBlockId = '7b58474daad00bf51a4bd75e8b59b679a2c11b13356ff3d8b6e0cc6fed4e8477'; // eslint-disable-line
const firstHardforkBlockHeight = 16270294;

function isValidRoverBlockRange(roverBlockRange) {
  if (roverBlockRange.getLowestHeight() < firstHardforkBlockHeight) {
    return false;
  }

  return true;
}

function isValidFetchBlock(fetchBlock) {
  if (fetchBlock.getFromBlock().getHeight() < firstHardforkBlockHeight) {
    return false;
  }

  return true;
}

function isValidRequestResync(resync) {
  if (resync.getLatestBlock() && resync.getLatestBlock().getHeight() < firstHardforkBlockHeight) {
    return false;
  }

  for (const interval of resync.getIntervalsList()) {
    if (interval.getFromBlock() && interval.getFromBlock().getHeight() < firstHardforkBlockHeight) {
      return false;
    }
  }

  return true;
}
/**
 * LSK Controller
 */
class Controller {

  constructor(config) {
    this._config = config;
    const networkConfig = merge(config, {
      networkName: BC_NETWORK === 'test' ? 'devnet' : 'mainnet',
      testnet: BC_NETWORK === 'test',
      randomizeNodes: true,
      bannedPeers: []
    });
    this._highestBlockFromNetwork = null;
    this._logger = logging.getLogger(__filename);
    this._blockCache = new LRUCache({
      max: 25000,
      maxAge: 1000 * 60 * 60
    });
    this._fetchIntervalStore = new FetchIntervalStore();
    this._fetchCache = new LRUCache({ max: 250 });
    // TODO pull this to networks config
    debug('network config = %O', networkConfig);

    console.log(config);
    this._rpc = new RpcClient();

    if (this._config.isStandalone) {
      this._blockStream = new StandaloneDummyStream(__filename);
    } else {
      debug('Creating real rpc stream');
      this._blockStream = this._rpc.rover.collectBlock((err, status) => {
        if (err) {
          this._logger.error('rover.collectBlock() err %O', err);
        }
        this._logger.info(`RPC stream closed, stats: ${status.toObject()}`);
      });
    }
  }

  async init() {
    debug('controller init start');
    this._network = await createNetwork(this._config);
    process.on('disconnect', () => {
      console.trace(e);
      this._logger.info('Parent exited');
      process.exit(1);
    });

    process.on('uncaughtException', e => {
      console.trace(e);
      this._logger.error('Uncaught exception %O', e);
      process.exit(3);
    });

    this._network.on('newLatestBlock', async latestBlock => {
      debug('got new latest block from network = %O', latestBlock);
      // TODO decouple this using a periodically emptied queue?
      const unifiedBlock = await createUnifiedBlock(this._config.isStandalone, latestBlock, this._rpc.rover, _createUnifiedBlock);
      debug('LSK Going to call this._rpc.rover.collectBlock() with block %o', latestBlock.header.height);
      if (!this._config.isStandalone) {
        writeBlock(this._blockStream, unifiedBlock);
      } else {
        this._logger.info('Rovered unified LSK block = %O', unifiedBlock.toObject());
      }
      this._highestBlockFromNetwork = unifiedBlock;
    });

    this._network.on('blocksSinceHash', async ({ blockId, blocks, isRequestByHeight }) => {
      try {
        debug('event: blocksSinceHash fetched %d blocks since hash %s, first block = %o', blocks.length, blockId, blocks[0]);
        const highestBlock = blocks[blocks.length - 1]; // blocks come from network in highest height -> lowest height order
        const highestBlockHexHash = highestBlock.header.blockID.toString('hex');
        // pass them to engine
        for (const block of blocks) {
          // TODO check against fetch cache
          const unifiedBlock = await createUnifiedBlock(this._config.isStandalone, block, this._rpc.rover, _createUnifiedBlock);
          debug('LSK Going to call this._rpc.rover.collectBlock() with from blockSinceHash, block.height = %d', block.header.height);
          if (!this._config.isStandalone) {
            writeBlock(this._blockStream, unifiedBlock);
          } else {
            debug('Rovered unified LSK block = %O', unifiedBlock.toObject());
          }
          this._fetchIntervalStore.foundBlock(block.header.height);
        }

        // after all blocks fetched in previous for loop, this condition should be true
        if (!this._fetchIntervalStore.isSeekingBlocks() && !isRequestByHeight) {
          const finishedInterval = this._fetchIntervalStore.getFinishedInterval(highestBlockHexHash);
          this.setBlockRange(finishedInterval);
          // check if not more intervals are in FetchIntervalStore and schedule next fetch (has range, getRange with hash...)
          setTimeout(() => {
            if (this._fetchIntervalStore.hasRange()) {
              const [highest, lowest] = this._fetchIntervalStore.nextRange();
              this.fetchBlock(highest, lowest);
            }
          }, 10 * 3000);
        } else if (!isRequestByHeight) {
          this._logger.warn('all blocks from interval were process, but FetchIntervalStore still did not see some block heights = %o', this._fetchIntervalStore);
        }
      } catch (err) {
        this._logger.error(err);
      }
    });

    this._network.start().then(() => {
      this._logger.info('Network discovery running successfully');
    }).catch(e => {
      this._logger.warn('Error while starting the network module, e = %O', e);
    });

    const rpcStream = this._rpc.rover.join(new RoverIdent(['lsk']));
    rpcStream.on('data', message => {
      debug(`rpcStream: Received ${JSON.stringify(message.toObject(), null, 2)}`);
      switch (message.getType()) {// Also could be message.getPayloadCase()
        case RoverMessageType.REQUESTRESYNC:
          {
            const payload = message.getResync();
            if (!isValidRequestResync(payload)) {
              this._logger.warn('requestResync is not valid, data = %o', payload.toObject());
              return;
            }
            debug('Got resync message %O', payload.toObject());
            this.startResync(payload);
            break;
          }

        case RoverMessageType.LATESTBLOCK:
          this._logger.info('latest block received from manager');
          break;

        case RoverMessageType.FETCHBLOCK:
          {
            const payload = message.getFetchBlock();
            if (!isValidFetchBlock(payload)) {
              this._logger.warn('fetchBlock is not valid, data = %o', payload.toObject());
              return;
            }
            const fromBlock = payload.getFromBlock();
            const toBlock = payload.getToBlock();
            this.fetchBlock(new IntervalLimit(toBlock.getHeight(), toBlock.getHash()), new IntervalLimit(fromBlock.getHeight(), fromBlock.getHash()));
            break;
          }

        case RoverMessageType.ROVER_BLOCK_RANGE:
          {
            const data = message.getRoverBlockRange();
            if (!isValidRoverBlockRange(data)) {
              this._logger.warn('roverBlockRange is not valid, data = %o', data.toObject());
              return;
            }
            debug('open block range request arrived, %O', data.toObject());
            this.requestBlockRange(data);
            break;
          }

        default:
          this._logger.warn(`Got unknown message type ${message.getType()}`);
      }
    });
    rpcStream.on('close', () => {
      this._logger.info(`gRPC stream from server closed`);
    });

    debug('controller initialized');
  }

  startResync(resyncMsg) {
    if (!this._highestBlockFromNetwork && !resyncMsg.getLatestBlock() && isEmpty(resyncMsg.getIntervalsList())) {
      // try again in 10s, maybe we have at least the latest block from network
      setTimeout(() => {
        this.startResync(resyncMsg);
      }, 10 * 3000);
      this._logger.warn('could start resync with completely empty resyncMsg and no _highestBlockFromNetwork');
      return;
    }

    const lastBlockHeight = this._highestBlockFromNetwork.getHeight();
    this._logger.debug(`startResync() lastBlockHeight: ${lastBlockHeight}`);

    function generateSyncIntervalsBetweenBlocks(fromBlock, toBlock) {
      // this means lowest, highest
      const fromHeight = fromBlock.getHeight();
      const toHeight = toBlock.getHeight();
      if (toHeight - fromHeight - 1 > LSK_MAX_FETCH_BLOCKS) {
        const boundaries = rangeStep(fromHeight, LSK_MAX_FETCH_BLOCKS, toHeight);
        const intervals = [];
        for (const boundary of boundaries) {
          const interval = [new IntervalLimit(boundary + LSK_MAX_FETCH_BLOCKS, ''), // highest
          new IntervalLimit(boundary, '') // lowest
          ];
          intervals.push(interval);
        }
        // we now only have has for the first intervals lowest block
        intervals[0][1].hash = fromBlock.getHash();
        return intervals;
      } else {
        return [[new IntervalLimit(toHeight, toBlock.getHash()), new IntervalLimit(fromHeight, fromBlock.getHash())]];
      }
    }
    if (!isEmpty(resyncMsg.getIntervalsList())) {
      for (const interval of flatten(resyncMsg.getIntervalsList())) {
        const fromBlock = interval.getFromBlock();
        const toBlock = interval.getToBlock();
        const intervals = generateSyncIntervalsBetweenBlocks(fromBlock, toBlock);
        for (const [highest, lowest] of intervals) {
          this._fetchIntervalStore.saveInterval(highest, lowest);
        }
      }
      // if known latest block is older than actual latest block, fetch /latestBlock - known latest block] interval too
      const knownLatestBlock = resyncMsg.getLatestBlock();
      if (knownLatestBlock && knownLatestBlock.getHeight() < lastBlockHeight) {
        const fromBlock = knownLatestBlock;
        const toBlock = this._highestBlockFromNetwork;
        const intervals = generateSyncIntervalsBetweenBlocks(fromBlock, toBlock);
        for (const [highest, lowest] of intervals) {
          debug('setting intervals for highest %o : lowest %o', highest, lowest);
          this._fetchIntervalStore.saveInterval(highest, lowest);
        }
      }
    } else {
      // we only have this._highestBlockFromNetwork and nothing from engine
      const blockCount = ROVER_RESYNC_PERIOD * 60 * 60 / ROVER_SECONDS_PER_BLOCK[ROVER_NAME];
      this._logger.info('skipping empty engine resync for now, would fetch %d blocks', blockCount);

      const fromBlock = new Block();
      fromBlock.setHash(LSK_GENESIS_BLOCKID_HEX);
      fromBlock.setHeight(LSK_GENESIS_HEIGHT);

      const toBlock = new Block();
      toBlock.setHeight(this._highestBlockFromNetwork.getHeight() - 1);
      const intervals = generateSyncIntervalsBetweenBlocks(fromBlock, toBlock);
      for (const [highest, lowest] of intervals) {
        debug('local only <- setting intervals for highest %o : lowest %o', highest, lowest);
        this._fetchIntervalStore.saveInterval(highest, lowest);
      }
      // lowest block number - we want to start with hash of this block but we only have height
    }
  }

  // This event overrides current logic in the LISK Rover as it has full view of the Lisk chain as known by Overline
  requestBlockRange(blockRange) {
    const lowestHeight = blockRange.getLowestHeight();
    const highestHeight = blockRange.getHighestHeight();
    if (!Number.isInteger(highestHeight) || !Number.isInteger(lowestHeight)) {
      this._logger.error('non numeric block range submitted, highest = %o, lowest = %o', highestHeight, lowestHeight);
      return;
    }

    debug(`request block range lowest: ${lowestHeight}, highest: ${highestHeight}`);

    const blockCount = highestHeight - lowestHeight;
    if (blockCount < 1 || blockCount > LSK_MAX_FETCH_BLOCKS) {
      this._logger.warn('ignoring invalid block range heights submitted, highest = %d, lowest = %d', highestHeight, lowestHeight);
      return;
    }

    this._fetchIntervalStore.saveInterval(new IntervalLimit(highestHeight, blockRange.getHighestHash()), new IntervalLimit(lowestHeight, blockRange.getLowestHash()));

    if (this._fetchIntervalStore.hasRange() && this._fetchIntervalStore.isSeekingBlocks()) {
      //  this._fetchIntervalStore._currentlySeekingHeights = null
      const [highest, lowest] = this._fetchIntervalStore.nextRange();
      debug(`range detected ${lowest} -> ${highest}`);
      this.fetchBlock(highest, lowest);
    } else {

      const highest = min(LSK_MAX_FETCH_BLOCKS + lowestHeight, highestHeight);
      const lowest = lowestHeight;
      debug(`range not detected ${lowest} -> ${highest}`);
      this._network.getBlocksByHeightBetween(lowest, highest).then(res => {
        debug(`range sent ${lowest} -> ${highest}`);
        res.isRequestByHeight = true;
        this._network.emit('blocksSinceHash', res);
      });
    }
  }

  fetchBlock(highest, lowest) {
    // let from = previousLast.getHeight()
    // let to = min(from + 10, parseInt(currentLast.getHeight(), 10))
    debug(`fetchBlock() from = %o to = %o`, lowest, highest);

    // TODO remove fetch cache?
    // for (let i = from; i <= to; i++) {
    //   this._fetchCache.set(i, true)
    // }
    // TODO check if rover is seeking for another interval and try later
    this._fetchIntervalStore.setCurrentlySeekingBlocks(highest, lowest);
    this._network.getBlocksSinceHash(Buffer.from(lowest.hash, 'hex'));
  }

  /*
   * ends the bounds of the block range ready for evaluation
   */
  setBlockRange(finishedInterval) {
    const [upper, lower] = finishedInterval;
    const payload = new RoverMessage.RoverBlockRange(['lsk', upper.height, lower.height, upper.hash, lower.hash]);
    this._rpc.rover.reportBlockRange(payload, (_, res) => {
      this._logger.debug('block range reported successfully, blockRange = %O', payload.toObject());
    });

    // // if a block range should be evaluated on disk report it to the controller
    // if (this._blockRangeUpperBound && this._blockRangeLowerBound && this._blockRangeUpperBound.hash && this._blockRangeLowerBound.hash) {
    //   this._logger.info(`setting block range upper hash ${this._blockRangeUpperBound.hash} lower hash ${this._blockRangeLowerBound.hash}`)
    //   this._rangeToFetch.length = 0
    //   // unsset the bounds allowing the bounds to be changed
    //   this._blockRangeUpperBound = undefined
    //   this._blockRangeLowerBound = undefined
    // // else if the block heights have not been found and nothing is pending their to resume the search, put the heights into their own segment
    // } else if (this._blockRangeUpperBound && this.BlockRangeLowerBound && this._rangeToFetch.length < 1) {
    //   if (!this._blockRangeUpperBound.hash || !this._blockRangeLowerBound.hash) {
    //     const highest = this._blockRangeUpperBound
    //     this._rangeToFetch.push([highest, this._blockRangeLowerBound.height])
    //   }
    // }
  }

  close() {
    this._network.stop().then(() => {
      debug('network module stopped successfully');
    }).catch(e => {
      console.trace('error occured while stopping network module, e = %O', e);
    });
    this._blockStream.end();
  }
}
exports.default = Controller;