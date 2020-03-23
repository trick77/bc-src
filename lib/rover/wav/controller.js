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
const { inspect } = require('util');
const WavesApi = require('waves-api');
const Events = require('events').EventEmitter;
const request = require('request');
const LRUCache = require('lru-cache');
const { concat, head, isEmpty, last, range, splitEvery } = require('ramda');
const { rangeStep } = require('../../utils/ramda');
const pRetry = require('p-retry');
const BN = require('bn.js');
const debug = require('debug')('bcnode:rover:wav:controller');

const { Block, MarkedTransaction } = require('../../protos/core_pb');
const { RoverMessage, RoverMessageType, RoverIdent, RoverSyncStatus } = require('../../protos/rover_pb');
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
const writeBlock = writeSafely('bcnode:rover:wav:controller');

const BC_NETWORK = 'main';
const WAVES_PEER_ADDRESS = "https://nodes.wavesnodes.com/peers/connected";
const WAVES_NODE_ADDRESS = BC_NETWORK === 'test' ? WavesApi.TESTNET_CONFIG.nodeAddress : WavesApi.MAINNET_CONFIG.nodeAddress;
const WAV_MAX_FETCH_BLOCKS = 6;
const WAV_EMB_ASSET_ID = networks[BC_NETWORK].rovers.wav.embAssetId;
const ROVER_NAME = 'wav';

// http://wavesgo.com:6869/peers/connected
// https://docs.wavesplatform.com/en/blockchain/transaction-type.html
const WAV_TRANSFER_TX_TYPE = 4;
const WAV_INVOKE_SCRIPT_TX_TYPE = 16;
const VALID_WAV_TX_TYPE = [WAV_TRANSFER_TX_TYPE, WAV_INVOKE_SCRIPT_TX_TYPE];

const wavEvents = new Events();
let peerList = false;
let foundPeer = false;
const getRandomPeer = exports.getRandomPeer = function () {

  return new Promise((resolve, reject) => {

    if (!BC_RANDOM_WAVES_PEER) {
      return resolve(WAVES_NODE_ADDRESS);
    }

    if (peerList) {
      if (foundPeer) {
        return resolve(foundPeer);
      }
      const addr = peerList[Math.floor(Math.random() * peerList.length)];
      return resolve(addr);
    } else {

      request({
        url: WAVES_PEER_ADDRESS,
        headers: { 'Accept': 'application/json' },
        timeout: 2500
      }, (err, response, body) => {
        if (err) {
          return reject(err);
        }
        try {
          const data = JSON.parse(body);
          if (data.status && data.status === 'error') {
            return reject(data);
          }
          const rawPeers = data.peers.map(r => {
            return r.address;
          });

          const targetPeers = rawPeers.filter(r => {
            if (r.indexOf('6868') > -1) {
              return r;
            }
          });
          const peers = targetPeers.reduce((all, p) => {
            const a = p.slice(1, p.length);
            const b = 'http://' + a.split(':')[0] + ':6869';
            all.push(b);
            return all;
          }, []);
          peerList = peers;
          const addr = peerList[Math.floor(Math.random() * peerList.length)];
          return resolve(addr);
        } catch (e) {
          return reject(e);
        }
      });
    }
  });
};

const getMerkleRoot = block => {
  if (!block.transactions || block.transactions.length === 0) {
    return blake2b(block.signature);
  }

  const txs = block.transactions.map(tx => tx.id);
  return txs.reduce((acc, el) => blake2b(acc + el), '');
};

const getLastHeight = exports.getLastHeight = function () {
  return new Promise(function (resolve, reject) {
    getRandomPeer().then(peerAddr => {
      request({
        url: `${peerAddr}/blocks/headers/last`,
        headers: { 'Accept': 'application/json' }
      }, (error, response, body) => {
        if (error) {
          return reject(error);
        }
        try {
          const data = JSON.parse(body);
          if (data.status === 'error') {
            return reject(data.details);
          }
          return resolve(data);
        } catch (e) {
          return reject(e);
        }
      });
    }).catch(err => {
      reject(err);
    });
  });
};

const getBlock = function (height) {
  return new Promise(function (resolve, reject) {
    const id = `${height}-getblock`;
    const cycleRequest = () => {
      // DEBUG
      getRandomPeer().then(peerAddr => {
        request({
          url: `${peerAddr}/blocks/at/${height}`,
          headers: { 'Accept': 'application/json' },
          timeout: 2500
        }, (error, response, body) => {
          if (error) {
            console.log(`wav.controller error: ${error}`);
            foundPeer = false;
            wavEvents.emit(id, false);
            return;
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            //reject(new Error(`Status code is: ${response.statusCode}`))
            // DEBUG
            // console.log(`status code is: ${response.statusCode}`)
            wavEvents.emit(id, false);
            foundPeer = false;
            return;
          }

          try {
            const data = JSON.parse(body);
            if (data.status === 'error') {
              // DEBUG
              // console.log(`wav.controller error ${data.details}`)
              wavEvents.emit(id, false, data.details);
              //return reject(data.details)
              return;
            }
            //return resolve(data)
            // DEBUG
            // console.log(`wav.conttroller block height found ${height}`)
            foundPeer = peerAddr;
            wavEvents.emit(id, data);
          } catch (e) {
            console.trace(e);
            wavEvents.emit(id, false);
          }
        });
      }).catch(err => {
        console.trace(err);
        wavEvents.emit(id, false);
      });
    };
    const interval = setInterval(() => {
      cycleRequest();
    }, randomInt(2600, 5000));
    wavEvents.once(id, (block, context) => {
      clearInterval(interval);
      if (!block) {
        return reject(new Error('failed to connect to waves peer host'));
      } else {
        resolve(block);
      }
    });
    cycleRequest();
  });
};

const getBlockSequence = function (heightFrom, heightTo) {
  return new Promise(function (resolve, reject) {
    const id = heightFrom;
    const cycleRequest = () => {
      // DEBUG
      // console.log(`seq wav.controller requesting block sequence ${heightFrom} ${heightTo} (${(heightTo - heightFrom)} blocks)`)
      getRandomPeer().then(peerAddr => {
        request({
          url: `${peerAddr}/blocks/seq/${heightFrom}/${heightTo}`,
          headers: { 'Accept': 'application/json' },
          timeout: 5500
        }, (error, response, body) => {
          if (error) {
            //DEBUG
            //console.log(`seq wav.controller error: ${error}`)
            wavEvents.emit(id, false);
            foundPeer = false;
            return;
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            //reject(new Error(`Status code is: ${response.statusCode}`))
            // DEBUG
            //console.log(`seq status code is: ${response.statusCode}`)
            foundPeer = false;
            wavEvents.emit(id, false);
            return;
          }

          try {
            const data = JSON.parse(body);
            if (data.status === 'error') {
              console.log(`seq wav.controller error ${data.details}`);
              //return reject(data.details)
              wavEvents.emit(id, false);
              return;
            }
            foundPeer = peerAddr;
            wavEvents.emit(id, data);
            //return resolve(data)
          } catch (e) {
            console.trace(e);
            wavEvents.emit(id, false);
          }
        });
      }).catch(err => {});
    };
    const interval = setInterval(() => {
      cycleRequest();
    }, randomInt(1000, 3000));
    wavEvents.once(id, blocks => {
      clearInterval(interval);
      if (!blocks) {
        return reject(new Error('failed to connect to waves peer host'));
      }
      return resolve(blocks);
    });
    cycleRequest();
  });
};

//const getBlockSequence = function (heightFrom: number, heightTo: number): Promise<Array<WavesBlock>> {
//  debug(`getBlockSequence(${heightFrom}, ${heightTo})`)
//  return new Promise(function (resolve, reject) {
//    request({
//      url: `${WAVES_NODE_ADDRESS}/blocks/seq/${heightFrom}/${heightTo}`,
//      headers: { 'Accept': 'application/json' },
//      timeout: 2000
//    }, (error, response, body) => {
//      if (error) {
//        return reject(error)
//      }
//
//      if (response.statusCode < 200 || response.statusCode >= 300) {
//        reject(new Error(`Status code is: ${response.statusCode}`))
//      }
//
//      try {
//        const data = JSON.parse(body)
//        if (data.status === 'error') {
//          return reject(data.details)
//        }
//        debug(`getBlockSequence() length: ${data.length} data: %o`, data.map(b => b.height))
//        return resolve(data)
//      } catch (e) {
//        return reject(e)
//      }
//    })
//  })
//}

async function _createUnifiedBlock(roverRpc, block, isStandalone) {
  const msg = new Block();
  msg.setBlockchain(ROVER_NAME);
  msg.setHash(block.signature);
  msg.setPreviousHash(block.reference);
  msg.setTimestamp(parseInt(block.timestamp, 10));
  msg.setHeight(block.height);
  msg.setMerkleRoot(getMerkleRoot(block));

  debug(`wav controller() _createUnifiedBlock(): processing height ${msg.getHeight()}`);

  const emblemTransactions = [];
  const settlementChecks = [];
  for (let tx of block.transactions) {
    let isEmbTx = WAV_EMB_ASSET_ID !== null && tx.type === WAV_TRANSFER_TX_TYPE && tx.assetId === WAV_EMB_ASSET_ID;

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
      settlementChecks.push([addrFrom, addrTo, value, bridgedChain, txId, blockHeight, tokenType]);
    }
  }

  debug(`Sending %o to be checked for settlement`, settlementChecks);
  let markedTransactions = await isBeforeSettleHeight(settlementChecks, roverRpc);

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
}

/**
 * WAV Controller
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

    process.on('uncaughtException', e => {
      this._logger.error(`uncaught exception: ${errToString(e)}`);
      process.exit(3);
    });

    const rpcStream = this._rpc.rover.join(new RoverIdent(['wav']));
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

    const { dfBound, dfVoid } = this._config.dfConfig.wav;

    const cycle = () => {
      this._timeoutDescriptor = setTimeout(() => {
        this._logger.debug(`pending requests: ${inspect(this._pendingRequests)}, pending fibers: ${inspect(this._pendingFibers.map(([ts, b]) => {
          return [ts, b.toObject()];
        }))}`);

        if (isEmpty(this._pendingRequests)) {
          getLastHeight().then(({ height, timestamp }) => {
            const ts = timestamp / 1000 << 0;
            const requestTime = randRange(ts, ts + Math.floor(dfBound));
            this._pendingRequests.push([requestTime, height - 4]);
            // push second further to future
            this._pendingRequests.push([requestTime + randRange(5, 60), height - 4]);
            cycle();
          }).catch(err => {
            cycle();
            this._logger.debug(`unable to start roving, could not get block count, err: ${err.message}`);
          });
          return;
        }

        const [requestTimestamp, requestBlockHeight] = this._pendingRequests.shift();
        if (requestTimestamp <= ts.nowSeconds()) {
          getBlockSequence(requestBlockHeight, requestBlockHeight + 2).then(async blocks => {
            if (blocks.length < 3) {
              this._pendingRequests.unshift([requestTimestamp + 10, requestBlockHeight]);
              cycle();
              return;
            }
            let block = blocks[0];
            this._logger.info(`rover transporting block : "${requestBlockHeight}" : ${block.signature.slice(0, 21)}`);
            if (!this._blockCache.has(requestBlockHeight)) {
              //this._blockCache.set(requestBlockHeight, true)
              this._logger.debug(`Unseen block with hash: ${block.signature} => using for BC chain`);

              const unifiedBlock = await createUnifiedBlock(this._config.isStandalone, block, this._rpc.rover, _createUnifiedBlock);
              if (unifiedBlock && this._blockRangeUpperBound && this._blockRangeUpperBound.height === unifiedBlock.getHeight()) {
                this._blockRangeUpperBound.hash = unifiedBlock.getHash();
              } else if (unifiedBlock && this._blockRangeLowerBound && this._blockRangeLowerBound.height === unifiedBlock.getHeight()) {
                this._blockRangeLowerBound.hash = unifiedBlock.getHash();
              }
              const formatTimestamp = unifiedBlock.getTimestamp() / 1000 << 0;
              const currentTime = ts.nowSeconds();
              this._pendingFibers.push([formatTimestamp, unifiedBlock]);

              const maxPendingHeight = this._pendingRequests[this._pendingRequests.length - 1][1];
              if (currentTime + 5 < formatTimestamp + dfBound) {
                this._pendingRequests.push([randRange(currentTime, formatTimestamp + dfBound), maxPendingHeight + 1]);
              } else {
                this._pendingRequests.push([randRange(currentTime, currentTime + 5), maxPendingHeight + 1]);
              }
            }
            cycle();
          }, reason => {
            //this._rpc.rover.reportSyncStatus(new RoverSyncStatus(['wav', false]), function (_, res) {
            throw new Error(reason);
            //})
          }).catch(err => {
            this._logger.debug(`error while getting new block height: ${requestBlockHeight}, err: ${errToString(err)}`);
            const moveBySeconds = 3;
            // postpone remaining requests
            this._pendingRequests = this._pendingRequests.map(([ts, height]) => [ts + moveBySeconds, height]);
            // prepend currentrequest back but schedule to try it in [now, now + 10s]
            // this._pendingRequests.unshift([randRange(ts.nowSeconds(), ts.nowSeconds() + 10) + moveBySeconds, requestBlockHeight])
            this._pendingRequests.unshift([randRange(ts.nowSeconds(), ts.nowSeconds() + 10) + moveBySeconds, requestBlockHeight]);
            cycle();
          });
        } else {
          // prepend request back to queue - we have to wait until time it is scheduled
          this._pendingRequests.unshift([requestTimestamp, requestBlockHeight]);
          cycle();
        }
      }, 2000);
    };

    const checkFibers = () => {
      if (isEmpty(this._pendingFibers)) {
        this._logger.debug(`no fiber ready, waiting: ${inspect(this._pendingFibers.map(([ts, b]) => [ts, b.getHash()]))}`);
        return;
      }
      //this._logger.info(`candidates ${this._pendingFibers.length}`)
      const fiberTs = this._pendingFibers[0][0];
      if (fiberTs + dfBound < ts.nowSeconds()) {
        const [, fiberBlock] = this._pendingFibers.shift();
        this._logger.debug('ready, going to call this._rpc.rover.collectBlock()');

        if (this._config.isStandalone) {
          this._logger.info(`would publish block: ${inspect(fiberBlock.toObject())}`);
          return;
        }

        if (fiberTs + dfVoid < ts.nowSeconds()) {
          this._logger.debug(`would publish block: ${inspect(fiberBlock.toObject())}`);
          process.exit(ROVER_DF_VOID_EXIT_CODE);
        }

        if (!this._config.isStandalone) {
          this._logger.debug(`starting cycle writeBlock ${fiberBlock.getHeight()}`);
          if (this._blockRangeUpperBound && this._blockRangeUpperBound.height === fiberBlock.getHeight()) {
            this._blockRangeUpperBound.hash = fiberBlock.getHash();
          } else if (this._blockRangeLowerBound && this._blockRangeLowerBound.height === fiberBlock.getHeight()) {
            this._blockRangeLowerBound.hash = fiberBlock.getHash();
          }
          writeBlock(this._blockStream, fiberBlock);
          //this.setBlockRange()
        }
      }
    };

    cycle();

    this._checkFibersIntervalID = setInterval(checkFibers, randomInt(1000, 3000));
  }

  async fetchBlock(previousLatest, currentLatest) {

    const { dfBound, dfVoid } = this._config.dfConfig.wav;

    let from = previousLatest.getHeight();
    let to = currentLatest.getHeight();

    // if more than WAV_MAX_FETCH_BLOCKS would be fetch, limit this to save centralized chains
    if (to - from > WAV_MAX_FETCH_BLOCKS) {
      this._logger.warn(`decreasing requested range of ${to - from} blocks to waves max  ${WAV_MAX_FETCH_BLOCKS}`);
      //from = to - WAV_MAX_FETCH_BLOCKS
      to = from + WAV_MAX_FETCH_BLOCKS;
      //const r = [to, parseInt(currentLatest.getHeight(), 10)]
      //this._rangeToFetch.push(r)
    }

    for (let i = from; i <= to; i++) {
      this._logger.info(`removing block ${i} from cache`);
      this._blockCache.del(i);
    }

    //const requestTime = randRange(ts, ts + dfBound)
    //this._pendingRequests.push([requestTime, height - 4])
    //// push second further to future
    //this._pendingRequests.push([requestTime + randRange(5, 15), height - 3])

    const whichBlocks = range(from, to).filter(m => {
      const found = this._pendingRequests.reduce((all, s) => {
        if (all) {
          return true;
        }
        if (m === s[1]) {
          all = true;
          return true;
        }
        return false;
      }, false);

      if (!found) {
        return m;
      }
    });

    this._logger.info('which blocks to use in query');
    this._logger.info(JSON.stringify(whichBlocks, null, 2));
    this._pendingRequests = this._pendingRequests.concat(whichBlocks.map((num, i) => [ts.nowSeconds() + 10 + i, num]));
    this._logger.info('pending blocks included');
    this._logger.info(JSON.stringify(this._pendingRequests, null, 2));
    this._pendingRequests = this._pendingRequests.sort((a, b) => {
      if (a[1] < b[1]) {
        return -1;
      }
      if (a[1] > b[1]) {
        return 1;
      }
      return 0;
    });

    //const blocks = await getBlockSequence(from, to)

    //if (!blocks) {
    //  this._logger.warn(`unable to get range from: ${from} to: ${to}`)
    //  return
    //}

    //for (let block of blocks) {
    //  const block = blocks.pop()
    //  const { height } = block
    //  //this._blockCache.set(height, true)
    //  this._logger.info(`Fetched block ${height} with hash: ${block.signature}`)
    //  const unifiedBlock = await createUnifiedBlock(this._config.isStandalone, block, this._rpc.rover, _createUnifiedBlock)
    //  const formatTimestamp = unifiedBlock.getTimestamp() / 1000 << 0
    //  const currentTime = ts.nowSeconds()
    //  //if (this._pendingFibers.length < 12) {
    //  //  this._logger.info(`adding to pending fibers ${unifiedBlock.getHeight()}`)
    //  //  this._pendingFibers.push([formatTimestamp, unifiedBlock])
    //  //} else {
    //  this._logger.info(`starting fetchblock writeBlock ${unifiedBlock.getHeight()}`)
    //  writeBlock(this._blockStream, unifiedBlock)
    //  //}
    //  if (unifiedBlock && this._blockRangeUpperBound && this._blockRangeUpperBound.height === unifiedBlock.getHeight()) {
    //    this._blockRangeUpperBound.hash = unifiedBlock.getHash()
    //  } else if (unifiedBlock && this._blockRangeLowerBound && this._blockRangeLowerBound.height === unifiedBlock.getHeight()) {
    //    this._blockRangeLowerBound.hash = unifiedBlock.getHash()
    //  }
    //}
    return Promise.resolve(true);
  }

  requestBlockRange(givenBlockRange) {
    if (!givenBlockRange || givenBlockRange.length < 2) {
      this._logger.error(`invalid block range length submitted`);
      return;
    }
    if (this._seekingSegment) {
      this._logger.warn(`cannot request block range while in active sync`);
      this._seekingSegment = false;
      return;
    }
    const highest = givenBlockRange[0];
    const lowest = givenBlockRange[1];
    const blockRange = [highest, lowest];

    for (let i = lowest; i <= highest; i++) {
      this._blockCache.del(i);
    }

    this._logger.info(`highest ${highest} for request lowest ${lowest} for request`);

    if (this._rangeToFetch.length > 0) {
      const prevHigh = this._rangeToFetch[0][0];
      const prevLow = this._rangeToFetch[0][1];

      if (prevHigh !== highest && prevLow !== lowest) {
        this._logger.debug(`updated block range prevHigh: ${prevHigh} -> highest: ${blockRange[0]} prevLow: ${prevLow} -> lowest ${blockRange[1]}`);
        this._rangeToFetch.length = 0;
        this._rangeToFetch.push(blockRange);
      }
    } else {
      this._logger.debug(`pushing block range highest ${blockRange[0]} lowest ${blockRange[1]}`);
      this._rangeToFetch.push(blockRange);
    }
    if (this._rangeToFetch.length > 0) {

      const r = this._rangeToFetch.pop();
      const fromBlock = new Block();
      const toBlock = new Block();
      fromBlock.setHeight(r[1]);
      toBlock.setHeight(r[0]);
      for (let i = r[1]; i < r[0]; i++) {
        if (this._blockCache.has(i)) this._blockCache.del(i);
      }
      this.fetchBlock(fromBlock, toBlock).then(() => {
        this._logger.info(`block sequence fetched`);
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
      const payload = new RoverMessage.RoverBlockRange(['wav', this._blockRangeUpperBound.height, this._blockRangeLowerBound.height, this._blockRangeUpperBound.hash, this._blockRangeLowerBound.hash]);
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

          if (resyncMsg) {
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
                debug(`Fetched block with hash: ${block.signature}`);
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
      }, randomInt(1000, 3000));
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