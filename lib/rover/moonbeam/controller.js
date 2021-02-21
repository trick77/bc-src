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
const Web3 = require('web3');
const { inspect } = require('util');
const Events = require('events').EventEmitter;
const request = require('request');
const LRUCache = require('lru-cache');
const { concat, head, isEmpty, last, range, splitEvery, min } = require('ramda');
const { rangeStep } = require('../../utils/ramda');
const pRetry = require('p-retry');
const BN = require('bn.js');
const debug = require('debug')('bcnode:rover:moonbeam:controller');

const { Block, MarkedTransaction } = require('../../protos/core_pb');
const { SettleTxCheckReq, RoverMessage, RoverMessageType, RoverIdent, RoverSyncStatus } = require('../../protos/rover_pb');
const { getLogger } = require('../../logger');
const { networks } = require('../../config/networks');
const { errToString } = require('../../helper/error');
const { blake2b } = require('../../utils/crypto');
const { RpcClient } = require('../../rpc');
const { createUnifiedBlock, isBeforeSettleHeight } = require('../helper');
const { capIntervalsToLength, randomInt } = require('../utils');
const { randRange } = require('../../utils/ramda');
const ts = require('../../utils/time').default; // ES6 default export
const { ROVER_DF_VOID_EXIT_CODE } = require('../manager');
const { StandaloneDummyStream, ROVER_RESYNC_PERIOD, ROVER_SECONDS_PER_BLOCK, writeSafely, batchProcess } = require('../utils');
const BC_RANDOM_WAVES_PEER = process.env.BC_RANDOM_WAVES_PEER === 'true'; // HIGH RISK, WAVES PEERS DO NOT MAINTAIN CONSENSUS
const writeBlock = writeSafely('bcnode:rover:moonbeam:controller');

process.on('uncaughtException', e => {
  console.trace(e);
  process.exit(3);
});

const BC_NETWORK = 'main';

const RPC_NODE_ADDRESS = 'https://moonbeam.overline.network:3001';
const WS_NODE_ADDRESS = 'ws://moonbeam.overline.network:9933';
const ROVER_NAME = 'moonbeam';

// list of wavs centralized nodes who failed
const peerFailed = [];

let peerList = false;
let foundPeer = false;

const getRandomRange = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

const getMerkleRoot = block => {
  if (!block.transactions || block.transactions.length === 0) {
    return blake2b(block.id);
  }

  const txs = block.transactions.map(tx => tx.id);
  return txs.reduce((acc, el) => blake2b(acc + el), '');
};

async function _createUnifiedBlock(roverRpc, block, isStandalone) {
  const msg = new Block();
  msg.setBlockchain(ROVER_NAME);
  msg.setHash(block.id);
  msg.setPreviousHash(block.reference);
  msg.setTimestamp(parseInt(block.timestamp, 10));
  msg.setHeight(block.height);
  msg.setMerkleRoot(getMerkleRoot(block));

  debug(`wav controller() _createUnifiedBlock(): processing height ${msg.getHeight()}`);

  const emblemTransactions = [];
  const settlementChecks = [];
  for (let tx of block.transactions) {
    let isEmbTx = false;

    if (!VALID_WAV_TX_TYPE.includes(tx.type)) {
      continue;
    }

    const addrFrom = tx.sender;
    let addrTo;
    let value = new BN(0).toBuffer();
    if (tx.type === WAV_TRANSFER_TX_TYPE) {
      addrTo = tx.recipient;
      value = new BN(tx.amount.toString(10), 10).toBuffer();
    } else {
      // tx type is 16
      addrTo = tx.dApp;
    }
    const bridgedChain = ROVER_NAME;
    const txId = tx.id;
    const blockHeight = msg.getHeight();
    const tokenType = isEmbTx ? 'emb' : ROVER_NAME;

    if (isEmbTx) {
      let tTx = new MarkedTransaction();
      tTx.setId(bridgedChain);
      tTx.setToken(tokenType); // TODO maybe assetId?
      tTx.setAddrFrom(addrFrom);
      tTx.setAddrTo(addrTo);
      tTx.setValue(new Uint8Array(value));

      tTx.setBlockHeight(msg.getHeight());
      tTx.setIndex(emblemTransactions.length);
      tTx.setHash(txId);
      emblemTransactions.push(tTx);
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
    }
  }

  try {
    debug(`Sending %o to be checked for settlement`, settlementChecks);
    let markedTransactions = (await isBeforeSettleHeight(settlementChecks, roverRpc, block.id)) || [];

    // if some marked transactions came from settlement check, we have to reindex emblem transactions
    if (markedTransactions && markedTransactions.length > 0) {
      for (var i = 0; i < emblemTransactions.length; i++) {
        emblemTransactions[i].setIndex(markedTransactions.length + i);
      }
    }

    markedTransactions = concat(markedTransactions || [], emblemTransactions);
    msg.setMarkedTxsList(markedTransactions);
    msg.setMarkedTxCount(markedTransactions.length);

    debug(`_createUnifiedBlock(): returning %o`, msg.toObject());

    return msg;
  } catch (e) {
    console.trace(e);
  }
}

/**
 * Moonbeam Controller
 */
class Controller {

  constructor(config) {
    this._config = config;
    this._logger = getLogger(__filename);
    this._rpc = new RpcClient();
    this._blockCache = new LRUCache({ max: 500 });
    this._lastBlockHeight = 0;
    this._blockRangeLowerBound = undefined;
    this._blockRangeUpperBound = undefined;
    this._seekingSegment = false;
    this._web3 = new Web3(new Web3.providers.WebsocketProvider(WS_NODE_ADDRESS));
    this._rangeToFetch = [];
    this._pendingRequests = [];
    this._pendingFibers = [];
    if (this._config.isStandalone) {
      this._blockStream = new StandaloneDummyStream(__filename);
    } else {
      this._blockStream = this._rpc.rover.collectBlock((err, status) => {
        if (err) {
          this._logger.error(`Error while writing to stream ${err.stack}`);
        }
        this._logger.info(`RPC stream closed, stats: ${status.toObject()}`);
      });
    }
  }

  init() {
    this._logger.debug('Initialized');

    process.on('disconnect', () => {
      this._logger.info('parent exited');
      process.exit();
    });

    const rpcStream = this._rpc.rover.join(new RoverIdent(['mb']));
    rpcStream.on('data', message => {
      this._logger.debug(`rpcStream: Received ${JSON.stringify(message.toObject(), null, 2)}`);
      switch (message.getType()) {// Also could be message.getPayloadCase()
        case RoverMessageType.REQUESTRESYNC:
          debug(`Got resync message %O`, message.getResync().toObject());
          this.startResync(message.getResync());
          break;

        case RoverMessageType.FETCHBLOCK:
          const payload = message.getFetchBlock();
          this.fetchBlock(payload.getFromBlock(), payload.getToBlock()).then(() => {
            this._logger.info(`block sequence fetched from fetch block`);
          });
          break;

        case RoverMessageType.ROVER_BLOCK_RANGE:
          this._logger.info(`open block range request arrived`);
          const data = message.getRoverBlockRange();
          this.requestBlockRange([data.getHighestHeight(), data.getLowestHeight()]);
          break;

        default:
          this._logger.warn(`Got unknown message type ${message.getType()}`);
      }
    });
    rpcStream.on('close', () => this._logger.info(`gRPC stream from server closed`));

    const subscription = this._web3.eth.subscribe('newBlockHeaders', (error, blockHeader) => {
      if (error) return console.error(error);
      console.log('Successfully subscribed!', blockHeader);
    }).on('data', blockHeader => {
      console.log('data: ', blockHeader);
    });
  }

  requestBlockRange(givenBlockRange) {
    if (!givenBlockRange || givenBlockRange.length < 2) {
      this._logger.error(`invalid block range length submitted`);
      return;
    }

    const lowest = givenBlockRange[1];
    const highest = min(lowest, givenBlockRange[0]);
    const blockRange = [highest, lowest];

    for (let i = lowest - 5; i <= highest + 2; i++) {
      this._blockCache.del(i);
    }

    if (this._seekingSegment) {
      this._logger.warn(`cannot request block range while in active sync`);
      this._seekingSegment = false;
      return;
    }

    this._logger.info(`highest ${highest} for request lowest ${lowest} for request`);

    //if (this._rangeToFetch.length > 0) {
    //  const prevHigh = this._rangeToFetch[0][0]
    //  const prevLow = this._rangeToFetch[0][1]

    //  if (prevHigh !== highest || prevLow !== lowest) {
    //    this._logger.debug(`updated block range prevHigh: ${prevHigh} -> highest: ${blockRange[0]} prevLow: ${prevLow} -> lowest ${blockRange[1]}`)
    //    this._rangeToFetch.length = 0
    //    this._rangeToFetch.push(blockRange)
    //  }
    //} else {
    //  this._logger.debug(`pushing block range highest ${blockRange[0]} lowest ${blockRange[1]}`)
    //  this._rangeToFetch.push(blockRange)
    //}
    if (this._rangeToFetch.length > 0) {

      const r = this._rangeToFetch.pop();
      const fromBlock = new Block();
      const toBlock = new Block();
      fromBlock.setHeight(r[1]);
      toBlock.setHeight(r[0]);
      for (let i = r[1]; i < r[0]; i++) {
        if (this._blockCache.has(i)) this._blockCache.del(i);
      }
      this.fetchBlock(fromBlock, toBlock, true).then(() => {
        //this._logger.info(`block sequence fetched`)
      });
    } else {

      const fromBlock = new Block();
      const toBlock = new Block();
      fromBlock.setHeight(lowest);
      toBlock.setHeight(highest);
      for (let i = lowest; i < highest; i++) {
        if (this._blockCache.has(i)) this._blockCache.del(i);
      }
      this.fetchBlock(fromBlock, toBlock, true).then(() => {
        //this._logger.info(`block sequence fetched`)
      });
    }
  }

  setBlockRange(nextRange) {
    if (nextRange) {
      if (nextRange.length > 1) {
        if (nextRange[0] === nextRange[1]) {
          throw Error('cannot set block range of equivalent heights');
        }
      }
    }
    // if a block range should be evaluated on disk report it to the controller
    if (this._blockRangeUpperBound && this._blockRangeLowerBound && this._blockRangeUpperBound.hash && this._blockRangeLowerBound.hash && this._rangeToFetch.length === 0) {
      debug(`setting block range upper hash ${this._blockRangeUpperBound.hash} lower hash ${this._blockRangeLowerBound.hash}`);
      const payload = new RoverMessage.RoverBlockRange(['moonbeam', this._blockRangeUpperBound.height, this._blockRangeLowerBound.height, this._blockRangeUpperBound.hash, this._blockRangeLowerBound.hash]);
      this._blockRangeUpperBound = undefined;
      this._blockRangeLowerBound = undefined;
      this._rpc.rover.reportBlockRange(payload, (_, res) => {
        this._logger.debug(`block range reported successfully`);
        // unsset the bounds allowing the bounds to be changed
      });
      // else if the block heights have not been found and nothing is pending their to resume the search, put the heights into their own segment
    }
    // only set block range if there are no requests waiting to be fetched
    if (nextRange && nextRange.length > 1 && this._rangeToFetch.length < 1) {
      this._blockRangeUpperBound = { height: nextRange[0], hash: false };
      this._blockRangeLowerBound = { height: nextRange[1], hash: false };
    }
  }

  startResync(resyncMsg) {
    if (!this._timeoutResync) {
      this._timeoutResync = setTimeout(() => {
        this._seekingSegment = true;
        getLastHeight().then(({ height, timestamp }) => {
          debug('startResync() getLastHeight successful %o %o', height, timestamp);
          let successCount = 0;
          let intervals;
          if (resyncMsg && !isEmpty(resyncMsg.getIntervalsList())) {
            const uncappedIntervals = [];
            for (const interval of resyncMsg.getIntervalsList()) {
              uncappedIntervals.push([interval.getFromBlock().getHeight(), interval.getToBlock().getHeight()]);
              intervals = capIntervalsToLength(uncappedIntervals, WAV_MAX_FETCH_BLOCKS);
            }
            debug(`Got missing intervals, uncapped: %o, capped: %o`, uncappedIntervals, intervals);
          } else if (this._rangeToFetch.length > 0) {
            const blockRange = this._rangeToFetch.pop();
            const to = blockRange[0];
            const from = blockRange[1];
            const boundaries = rangeStep(from, WAV_MAX_FETCH_BLOCKS, to);
            let whichBlocks = range(from, to);
            this._blockRangeUpperBound = { height: to, hash: undefined };
            this._blockRangeLowerBound = { height: from, hash: undefined };
            this._logger.info(`rangeToFetch to ${to} from ${from}`);
            intervals = splitEvery(WAV_MAX_FETCH_BLOCKS, whichBlocks).map(arr => [head(arr), last(arr)]);
          } else {
            const from = height - ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK['wav'] | 0;
            const to = height;
            let whichBlocks = range(from, to);
            debug(`Getting ${whichBlocks.length} blocks`); // XXX remove after debug
            intervals = splitEvery(WAV_MAX_FETCH_BLOCKS, whichBlocks).map(arr => [head(arr), last(arr)]);
          }

          if (resyncMsg && resyncMsg.getLastestBlock) {
            const knownLatestBlock = resyncMsg.getLatestBlock();
            debug('knownLatestBlock: %o, got last height: %o', knownLatestBlock ? knownLatestBlock.toObject() : {}, height);
            if (knownLatestBlock && knownLatestBlock.getHeight() < height) {
              const lastBlockInterval = capIntervalsToLength([[knownLatestBlock.getHeight(), height]], WAV_MAX_FETCH_BLOCKS);
              debug(`Last known block is stale, adding %o to sync to the latest known block`, lastBlockInterval);
              intervals = concat(lastBlockInterval, intervals);
            }
          }

          batchProcess(1, intervals.map(([from, to]) => {
            return () => pRetry(function () {
              return getBlockSequence(from, to);
            }, {
              onFailedAttempt: function (error) {
                debug(`Block interval ${from} - ${to} attempt ${error.attemptNumber} failed. There are ${error.retriesLeft} retries left. Total: ${intervals.length}, success: ${successCount}`);
              },
              factor: 1.1,
              randomize: true,
              maxRetryTime: 10000,
              maxTimeout: 5e3
            }).then(async blocks => {
              if (!this._blockRangeUpperBound) {
                this._blockRangeUpperBound = { height: to, hash: undefined };
              }
              if (!this._blockRangeLowerBound) {
                this._blockRangeLowerBound = { height: from, hash: undefined };
              }

              for (let block of blocks) {
                const { height } = block;
                debug(`Got block at height: ${height}`);
                // if (!this._blockCache.has(height)) {
                //this._blockCache.set(height, true)
                debug(`Fetched block with hash: ${block.id}`);
                const unifiedBlock = await createUnifiedBlock(this._config.isStandalone, block, this._rpc.rover, _createUnifiedBlock);
                if (!this._config.isStandalone) {
                  debug(`starting resync writeBlock ${unifiedBlock.getHeight()}`);
                  writeBlock(this._blockStream, unifiedBlock);
                  if (unifiedBlock && this._blockRangeUpperBound && this._blockRangeUpperBound.height === unifiedBlock.getHeight()) {
                    this._blockRangeUpperBound.hash = unifiedBlock.getHash();
                  } else if (unifiedBlock && this._blockRangeLowerBound && this._blockRangeLowerBound.height === unifiedBlock.getHeight()) {
                    this._blockRangeLowerBound.hash = unifiedBlock.getHash();
                  }
                } else {
                  this._logger.info(`Collected WAV block ${unifiedBlock.getHeight()}, h: ${unifiedBlock.getHash()}`);
                }
                // }
              }

              successCount++;
              if (successCount === intervals.length || successCount + 5 >= intervals.length) {
                this._timeoutResync = undefined;
                this._seekingSegment = false;
                debug(`initial resync finished`);
                this._rpc.rover.reportSyncStatus(new RoverSyncStatus(['wav', true]), (_, res) => {
                  debug(`Status reported back successfully`);
                  //this.setBlockRange()
                });
              }
            });
          }));
        }).catch(err => {
          this._seekingSegment = false;
          this._logger.error(err);
        });
      }, randomInt(4000, 6000));
    }
  }

  close() {
    this._blockStream.end();
    ts.stop();
    this._timeoutDescriptor && clearTimeout(this._timeoutDescriptor);
    this._checkFibersIntervalID && clearInterval(this._checkFibersIntervalID);
  }
}
exports.default = Controller;