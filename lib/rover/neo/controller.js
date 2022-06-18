'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _bn = require('bn.js');

var _bn2 = _interopRequireDefault(_bn);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const Neon = require('@cityofzion/neon-js');
const { inspect } = require('util');
const LRUCache = require('lru-cache');
const { concat, isEmpty, partial, range, sort, splitEvery, uniq, min, max } = require('ramda');
const pRetry = require('p-retry');
const debug = require('debug')('bcnode:rover:neo:controller');

const { getBlockCount, getBlock, Pool } = require('./lib');
const { Block, MarkedTransaction } = require('@overline/proto/proto/core_pb');
const { parseBoolean } = require('../../utils/config');
const { SettleTxCheckReq, RoverMessageType, RoverIdent, RoverSyncStatus, RoverMessage } = require('@overline/proto/proto/rover_pb');
const logging = require('../../logger');
const { networks } = require('../../config/networks');
const { errToString } = require('../../helper/error');
const { RpcClient } = require('../../rpc');
const { createUnifiedBlock, isBeforeSettleHeight, getQueuedMarkedTxs } = require('../helper');
const { randomInt } = require('../utils');
const { randRange } = require('../../utils/ramda');
const ts = require('../../utils/time').default; // ES6 default export
const { ROVER_DF_VOID_EXIT_CODE } = require('../manager');
const { StandaloneDummyStream, ROVER_RESYNC_PERIOD, ROVER_SECONDS_PER_BLOCK, writeSafely, batchProcess } = require('../utils');
const writeBlock = writeSafely('bcnode:rover:neo:controller');

const BC_NETWORK = process.env.BC_NETWORK || 'main';
const BC_NEO_MAX_FAILURES = process.env.BC_NEO_MAX_FAILURES || 25;
const NEO_NETWORK_PROFILE = 'mainnet'; // do not use NEO testnet // BC_NETWORK !== 'main' ? 'testnet' : 'mainnet'
const NEO_MAX_FETCH_BLOCKS = 10;
const NEO_EMB_ASSET_ID = networks[BC_NETWORK].rovers.neo.embAssetId;
const BC_MINER_BOOT = parseBoolean(process.env.BC_MINER_BOOT); // initialize new super collider
const _TRANSFER_CALL_BUF = Buffer.from('transfer').toString('hex');
const ROVER_NAME = 'neo';

process.on('uncaughtException', err => {
  /* eslint-disable */
  //console.trace(err)
  /* eslint-enable */
  process.exit();
});

const logger = logging.getLogger('rover.neo.controller.createUnifiedBlock', false);
async function _createUnifiedBlock(roverRpc, block, isStandalone) {
  debug(`Got block ${block.hash}`);
  const obj = {};

  obj.blockNumber = block.index;
  obj.prevHash = block.previousblockhash;
  obj.blockHash = block.hash;
  obj.root = block.merkleroot;
  obj.size = block.size;
  obj.nonce = block.nonce;
  obj.nextConsensus = block.nextconsensus;
  obj.timestamp = block.time * 1000;
  obj.version = block.version;
  obj.transactions = block.tx.reduce(function (all, t) {
    const tx = {
      txHash: t.txid,
      // inputs: t.inputs,
      // outputs: t.outputs,
      marked: false
    };
    all.push(tx);
    return all;
  }, []);

  const msg = new Block();
  msg.setBlockchain(ROVER_NAME);
  msg.setHash(obj.blockHash);
  msg.setPreviousHash(obj.prevHash);
  msg.setTimestamp(obj.timestamp);
  msg.setHeight(obj.blockNumber);
  msg.setMerkleRoot(obj.root);

  const emblemTransactions = [];
  const settlementChecks = [];
  const bridgedChain = ROVER_NAME;

  for (let tx of block.tx) {
    const tokenType = ROVER_NAME;
    if (tx.type === 'ContractTransaction') {
      let publicKey = tx.scripts[0].verification.slice(2).slice(0, -2);
      const scriptHash = Neon.wallet.getScriptHashFromPublicKey(publicKey);
      const addrFrom = Neon.wallet.getAddressFromScriptHash(scriptHash);
      for (let out of tx.vout) {
        if (out.asset === '0xc56f33fc6ecfcd0c225c4ab356fee59390af8560be0e930faebe74a6daff7c9b') {
          const pTx = new SettleTxCheckReq.PossibleTransaction();
          pTx.setAddrFrom(addrFrom);
          pTx.setAddrTo(out.address);
          pTx.setValue(new Uint8Array(new _bn2.default(out.value).toBuffer()));
          pTx.setBridgedChain(bridgedChain);
          pTx.setTxId(tx.txid);
          pTx.setBlockHeight(block.index);
          pTx.setTokenType(tokenType);
          settlementChecks.push(pTx);
        }
      }
    } else if (tx.type === 'InvocationTransaction') {
      const stringStream = new Neon.u.StringStream(tx.script);
      let scripts = [];
      let script;
      let hasScript = true;
      while (hasScript) {
        try {
          // script = Neon.default.deserialize.script(stringStream)
          script = Neon.default.deserialize.script(stringStream);
          scripts.push(script);
        } catch (err) {
          // console.trace(err)
          // could not decode more
          hasScript = false;
        }
      }

      if (scripts.length !== 2) {
        logger.debug(`Not exactly 2 scripts`);
        continue;
      }
      logger.debug(scripts);
      const { invocationScript: amountRaw, verificationScript: toAddrRaw } = scripts[0];
      const { invocationScript: fromAddrRaw, verificationScript: scriptAvm } = scripts[1];

      let amount;
      let addrFrom;
      let addrTo;
      let scriptParams;
      try {
        amount = Neon.u.Fixed8.fromReverseHex(amountRaw).toString();
        addrFrom = Neon.wallet.getAddressFromScriptHash(Neon.u.reverseHex(fromAddrRaw));
        addrTo = Neon.wallet.getAddressFromScriptHash(Neon.u.reverseHex(toAddrRaw));
        scriptParams = new Neon.sc.ScriptBuilder(scriptAvm).toScriptParams();
      } catch (e) {
        //logger.error(e)
        logger.warn(`failed to decode tx scripts (txid: ${tx.txid}), scripts: ${inspect(scripts)}`);
        continue;
      }

      if (scriptParams.length !== 1 || scriptParams[0].args.length !== 2 || scriptParams[0].args[0] !== _TRANSFER_CALL_BUF) {
        continue;
      }

      const assetId = scriptParams[0].scriptHash;
      logger.debug(`f: ${addrFrom}, t: ${addrTo}, amt: ${amount}, asset: http://neotracker.io/asset/${assetId}`);

      const isEmbTx = assetId === NEO_EMB_ASSET_ID;
      // FIXME this check has to happen even though there it no embTx

      const value = Buffer.from(amount, 'hex');
      const bridgedChain = ROVER_NAME;
      const txId = tx.txid;
      const blockHeight = msg.getHeight();
      const tokenType = isEmbTx ? 'emb' : ROVER_NAME;

      if (isEmbTx) {
        const tTx = new MarkedTransaction();
        tTx.setId(bridgedChain);
        tTx.setToken(tokenType);
        tTx.setAddrFrom(addrFrom);
        tTx.setAddrTo(addrTo);
        tTx.setValue(new Uint8Array(value));
        tTx.setBlockHeight(blockHeight);
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
  }

  debug(`_createUnifiedBlock() got ${emblemTransactions.length} EMB TXs and ${settlementChecks.length} settlementChecks`);

  try {
    let markedTransactions = (await isBeforeSettleHeight(settlementChecks, roverRpc, block.hash, 'neo')) || [];

    // if some marked transactions came from settlement check, we have to reindex emblem transactions
    if (markedTransactions && markedTransactions.length > 0) {
      for (var i = 0; i < emblemTransactions.length; i++) {
        emblemTransactions[i].setIndex(markedTransactions.length + i);
      }
    }

    markedTransactions = concat(markedTransactions || [], emblemTransactions);

    const queuedMarkedTransactions = (await getQueuedMarkedTxs(markedTransactions, roverRpc, block.hash, 'neo')) || [];
    logger.debug(`neo queued mtx: ${queuedMarkedTransactions.length}`);

    msg.setMarkedTxsList(markedTransactions);
    msg.setMarkedTxCount(markedTransactions.length);
    debug(`_createUnifiedBlock() returning block %o`, msg.toObject());

    return msg;
  } catch (e) {
    console.trace(e);
  }
}

/**
 * NEO Controller
 */
class Controller {

  constructor(config) {
    this._config = config;
    this._neoMeshFailures = 0;
    this._logger = logging.getLogger(__filename);
    this._rangeToFetch = [];
    this._seekingSegment = false;
    this._blockCache = new LRUCache({
      max: 15000,
      ttl: 1000 * 60 * 60
    });
    this._neoMesh = new Pool(NEO_NETWORK_PROFILE);
    this._rpc = new RpcClient();
    if (this._config.isStandalone) {
      this._blockStream = new StandaloneDummyStream(__filename);
    } else {
      this._blockStream = this._rpc.rover.collectBlock((err, status) => {
        if (err) {
          this._logger.error(`Error while writing to stream ${err.stack}`);
          process.exit();
        }
        this._logger.info(`RPC stream closed, stats: ${status.toObject()}`);
      });
    }
    this._pendingRequests = [];
    this._pendingFibers = [];
    ts.start();
  }

  init() {
    this._logger.info('initialized');

    process.on('disconnect', () => {
      this._logger.info('parent exited');
      process.exit(2);
    });

    const rpcStream = this._rpc.rover.join(new RoverIdent(['neo']));
    rpcStream.on('data', message => {
      debug(`rpcStream: Received ${JSON.stringify(message.toObject(), null, 2)}`);
      debug('data from rpc stream: ' + message.getType());
      switch (message.getType()) {// Also could be message.getPayloadCase()
        case RoverMessageType.REQUESTRESYNC:
          debug(`Resync message received: %o`, message.getResync().toObject());
          this._resyncData = message.getResync();
          if (!this._timeoutResync) {
            this.startResync(message.getResync());
          }
          break;

        case RoverMessageType.LATESTBLOCK:
          this._logger.info(`latest block received from manager`);
          break;

        case RoverMessageType.FETCHBLOCK:
          const payload = message.getFetchBlock();
          this.fetchBlock(payload.getFromBlock(), payload.getToBlock());
          break;

        case RoverMessageType.ROVER_BLOCK_RANGE:
          const data = message.getRoverBlockRange();
          this._logger.info(`open block range request arrived highest ${data.getHighestHeight()} lowest ${data.getLowestHeight()}`);

          const fromBlock = new Block();
          const toBlock = new Block();
          fromBlock.setHeight(data.getLowestHeight());
          toBlock.setHeight(data.getHighestHeight());
          this.requestBlockRange([data.getHighestHeight(), data.getLowestHeight()]);
          // this.fetchBlock(fromBlock, toBlock)

          break;

        default:
          this._logger.warn(`Got unknown message type ${message.getType()}`);
      }
    });
    rpcStream.on('close', () => this._logger.info(`gRPC stream from server closed`));

    const { dfBound, dfVoid } = this._config.dfConfig.neo;

    const cycle = () => {
      this._timeoutDescriptor = setTimeout(async () => {
        const node = this._neoMesh.getBestNode();
        debug(`Pending requests: ${inspect(this._pendingRequests)}, pending fibers: ${inspect(this._pendingFibers.map(([ts, b]) => {
          return [ts, b.toObject()];
        }))}`);
        if (isEmpty(this._pendingRequests)) {
          getBlockCount(node).then(height => getBlock(node, height - 1)).then(block => {
            const ts = block.time;
            const requestTime = randRange(ts, ts + dfBound);
            debug(block.index + ' <-- index --> ' + ' request time: ' + (ts + dfBound) + ' current time: ' + ts);
            this._pendingRequests.push([requestTime, block.index]);
            // push second further to future
            this._pendingRequests.push([requestTime + 5, block.index + 1]);
            setTimeout(cycle, 5000);
          }).catch(err => {
            debug(`unable to start roving, could not get block count, err: ${err.message}`);
            setTimeout(cycle, 5000);
          });
          return;
        }

        const [requestTimestamp, requestBlockHeight] = this._pendingRequests.shift();
        if (requestTimestamp <= ts.nowSeconds()) {
          getBlock(node, requestBlockHeight).then(async block => {
            debug(`neo height set to ${requestBlockHeight}`);
            if (this._blockRangeUpperBound) {
              if (block.index === this._blockRangeUpperBound.height) {
                this._blockRangeUpperBound.hash = block.hash;
              }
            }

            if (this._blockRangeLowerBound) {
              if (block.index === this._blockRangeLowerBound.height) {
                this._blockRangeLowerBound.hash = block.hash;
              }
            }

            if (!this._blockCache.has(requestBlockHeight)) {
              this._blockCache.set(requestBlockHeight, true);
              debug(`Unseen block with hash: ${block.hash} => using for BC chain`);

              const unifiedBlock = await createUnifiedBlock(this._config.isStandalone, block, this._rpc.rover, _createUnifiedBlock);
              const formatTimestamp = unifiedBlock.getTimestamp() / 1000 << 0;
              const currentTime = ts.nowSeconds();
              this._pendingFibers.push([formatTimestamp, unifiedBlock]);
              if (this._pendingRequests[this._pendingRequests.length - 1] && this._pendingRequests[this._pendingRequests.length - 1].length > 1) {
                const maxPendingHeight = this._pendingRequests[this._pendingRequests.length - 1][1];
                if (currentTime + 5 < formatTimestamp + dfBound) {
                  this._pendingRequests.push([randRange(currentTime, formatTimestamp + dfBound), maxPendingHeight + 1]);
                } else {
                  this._pendingRequests.push([randRange(currentTime, currentTime + 5), maxPendingHeight + 1]);
                }
              }
              this.setBlockRange();
            }
            setTimeout(cycle, 2000);
          }, reason => {
            //this._logger.error(reason)
            throw new Error(reason);
          }).catch(err => {
            debug(`error while getting new block height: ${requestBlockHeight}, err: ${errToString(err)}`);
            // postpone remaining requests
            this._pendingRequests = this._pendingRequests.map(([ts, height]) => [ts + 10, height]);
            // prepend currentrequest back but schedule to try it in [now, now + 10s]
            this._pendingRequests.unshift([randRange(ts.nowSeconds(), ts.nowSeconds() + 10), requestBlockHeight]);
            setTimeout(cycle, 5000);
          });
        } else {
          // prepend request back to queue - we have to wait until time it is scheduled
          this._pendingRequests.unshift([requestTimestamp, requestBlockHeight]);
          setTimeout(cycle, 5000);
        }
      }, 1000);
      //if (this._rangeToFetch.length > 0 && !this._blockRangeLowerBound && this._seekingSegment) {
      //  this.startResync()
      //}
    };

    const checkFibers = () => {
      if (isEmpty(this._pendingFibers)) {
        debug(`no fiber available, waiting: ${inspect(this._pendingFibers.map(([ts, b]) => [ts, b.getHash()]))}`);
        return;
      }
      debug(`Fibers count ${this._pendingFibers.length}`);
      const fiberTs = this._pendingFibers[0][0];
      if (fiberTs + dfBound < ts.nowSeconds()) {
        const [, fiberBlock] = this._pendingFibers.shift();
        debug('NEO Fiber is ready, going to call this._rpc.rover.collectBlock()');

        if (this._config.isStandalone) {
          debug(`Would publish block: ${inspect(fiberBlock.toObject())}`);
          return;
        }

        if (fiberTs + dfVoid < ts.nowSeconds()) {
          debug(`Would publish block: ${inspect(fiberBlock.toObject())}`);
          // process.exit(ROVER_DF_VOID_EXIT_CODE)
          process.exit(7);
        }

        if (!this._config.isStandalone) {
          writeBlock(this._blockStream, fiberBlock);
          this.setBlockRange();
        } else {
          this._logger.info(`Rovered NEO block: ${inspect(fiberBlock.toObject())}`);
        }
      }
    };

    this._neoMesh.init().then(() => {
      cycle();
      if (this._resyncData) {
        debug(`Starting resync - we have resync data %o`, this._resyncData.toObject());
        this.startResync(this._resyncData);
      }
    });

    this._checkFibersIntervalID = setInterval(checkFibers, randomInt(1000, 2000));

    const rateOfReq = BC_MINER_BOOT ? 60000 : 4000;

    setInterval(() => {
      const stats = this._neoMesh.getStats();
      if (stats) {
        const { all, correct, bestHeight } = this._neoMesh.getStats();
        this._logger.info(`mesh count pool: ${correct}/${all}, bh: ${bestHeight}`);
        const failureCount = max(0, this._neoMeshFailures - 1);
        this._neoMeshFailures = failureCount;
      } else {
        this._neoMeshFailures++;
        if (this._neoMeshFailures >= BC_NEO_MAX_FAILURES) {
          this._logger.warn(`unable to reach NEO mesh, max attempt range (${BC_NEO_MAX_FAILURES}) reached, restarting rover connections...`);
          process.exit();
        } else {
          this._logger.warn(`unable to reach NEO mesh, retrying in 9 seconds, attempt ${this._neoMeshFailures} of ${BC_NEO_MAX_FAILURES}`);
        }
      }
    }, rateOfReq);
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
    if (this._blockRangeUpperBound && this._blockRangeLowerBound && this._blockRangeUpperBound.hash && this._blockRangeLowerBound.hash) {
      debug(`setting block range upper hash ${this._blockRangeUpperBound.hash} lower hash ${this._blockRangeLowerBound.hash}`);
      const payload = new RoverMessage.RoverBlockRange(['neo', this._blockRangeUpperBound.height, this._blockRangeLowerBound.height, this._blockRangeUpperBound.hash, this._blockRangeLowerBound.hash]);
      this._rpc.rover.reportBlockRange(payload, (_, res) => {
        debug(`block range reported successfully`);
      });
      // unsset the bounds allowing the bounds to be changed
      this._blockRangeUpperBound = undefined;
      this._blockRangeLowerBound = undefined;
      // else if the block heights have not been found and nothing is pending their to resume the search, put the heights into their own segment
    } else if (this._blockRangeUpperBound && this._blockRangeLowerBound && this._rangeToFetch.length < 1) {
      if (!this._blockRangeUpperBound.hash || !this._blockRangeLowerBound.hash) {
        // only set block range if there are no requests waiting to be fetched
        if (nextRange && nextRange.length > 1 && this._rangeToFetch.length < 1) {
          this._blockRangeUpperBound = { height: nextRange[0], hash: false };
          this._blockRangeLowerBound = { height: nextRange[1], hash: false };
        }
        const highest = min(NEO_MAX_FETCH_BLOCKS + this._blockRangeLowerBound.height, this._blockRangeUpperBound.height);
        //const highest = this._blockRangeUpperBound.height
        const lowest = this._blockRangeLowerBound.height;
        this._rangeToFetch.push([highest, lowest]);
      }
    }
  }
  requestBlockRange(blockRange) {
    if (blockRange.length < 2) {
      this._logger.error(`invalid block range length submitted`);
      return;
    }
    if (this._timeoutResync) {
      this._logger.warn(`range requested while resync request is active`);
      //return
    }
    //if (this._seekingSegment) {
    //  this._logger.warn(`range requested while resync request is active`)
    //  return
    //}
    const highest = blockRange[0];
    const lowest = blockRange[1];
    const r = [highest, lowest];

    this._logger.info(`provided ranged highest: ${highest} lowest: ${lowest}`);

    if (this._rangeToFetch.length > 0) {
      const prevHigh = this._rangeToFetch[0][0];
      const prevLow = this._rangeToFetch[0][1];

      if (prevHigh < highest || prevLow > lowest) {
        this._logger.info(`updated block range prevHigh: ${prevHigh} -> highest: ${r[0]} prevLow: ${prevLow} -> lowest ${lowest}`);
        this._rangeToFetch.length = 0;
        this._rangeToFetch.push(r);
        for (let i = lowest; i < highest; i++) {
          this._blockCache.delete(i);
        }
      }
    } else {
      this._logger.info(`pushing block range highest ${r[0]} lowest ${r[1]}`);
      for (let i = lowest; i < highest; i++) {
        this._blockCache.delete(i);
      }
      this._rangeToFetch.push(r);
    }

    this._logger.info(`requestBlockRange(): range to fetch count is: ${this._rangeToFetch.length}`);

    //if (this._rangeToFetch.length > 0 && !this._seekingSegment) {
    if (this._rangeToFetch.length > 0) {
      this._logger.info(`requestBlockRange(): starting resync from this._rangeToFetch[0]`);
      this.startResync();
    }
  }

  startResync(resyncMsg) {
    debug(`needs_resync starting`);
    if (!this._timeoutResync) {
      this._timeoutResync = setTimeout(() => {
        pRetry(() => {
          debug('retrying getBlockCount()');
          return getBlockCount(this._neoMesh.getBestNode());
        }, {
          onFailedAttempt: error => {
            //clearTimeout(this._timeoutResync)
            //this._timeoutResync = undefined
            this._seekingSegment = false;
            debug(`Block attempt ${error.attemptNumber} failed. There are ${error.retriesLeft} retries left.`);
          },
          factor: 1.1,
          randomize: true
        }).then(height => {
          debug(`Got block count ${height}`);
          let whichBlocks = [];
          if (resyncMsg && !isEmpty(resyncMsg.getIntervalsList())) {
            for (const interval of resyncMsg.getIntervalsList()) {
              whichBlocks = range(interval.getFromBlock().getHeight() + 1, interval.getToBlock().getHeight()).concat(whichBlocks);
            }
            if (!this._blockRangeUpperBound) {
              this._blockRangeUpperBound = { height: whichBlocks[whichBlocks.length - 1], hash: false };
              this._blockRangeLowerBound = { height: whichBlocks[0], hash: false };
            }
            this._seekingSegment = true;
          } else if (this._rangeToFetch.length > 0 && !resyncMsg) {
            const r = this._rangeToFetch.pop();
            const to = r[0];
            const from = r[1];
            this._logger.info(`startResync(): requesting range from ${from} to ${to}`);
            this._blockRangeUpperBound = { height: to, hash: false };
            this._blockRangeLowerBound = { height: from, hash: false };
            for (let i = from; i < to; i++) {
              if (this._blockCache.has(i)) this._blockCache.delete(i);
            }
            whichBlocks = range(from, to);
            this._seekingSegment = true;
          } else if (!this._seekingSegment && this._rangeToFetch.length < 1) {
            const from = height - ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK['neo'] | 0;
            const to = height;
            whichBlocks = range(from, to);
            logging.getLogger(__filename).info(`requesting block heights from: ${from} to: ${to}`);
            for (let i = from; i < to; i++) {
              if (this._blockCache.has(i)) this._blockCache.delete(i);
            }
            this._seekingSegment = true;
          } else {
            // invalid resync request
            this._logger.info(`resync request yielded`);
            this._seekingSegment = false;
            if (this._timeoutResync) {
              clearTimeout(this._timeoutResync);
            }
            this._timeoutResync = undefined;
            return;
          }

          if (resyncMsg && resyncMsg.getLatestBlock) {
            const knownLatestBlock = resyncMsg.getLatestBlock();
            if (knownLatestBlock && knownLatestBlock.getHeight() < height) {
              whichBlocks = range(knownLatestBlock.getHeight(), height).concat(whichBlocks);
            }
          }
          if (!this._blockRangeLowerBound) {
            this._blockRangeLowerBound = { height: whichBlocks[0], hash: false };
            this._blockRangeUpperBound = { height: whichBlocks[whichBlocks.length - 1], hash: false };
          }

          // sort blocks in reverse order
          whichBlocks = uniq(sort((a, b) => b - a, whichBlocks));
          let successCount = 0;
          const batchLength = NEO_NETWORK_PROFILE === 'mainnet' ? 3 : 1;
          const batches = splitEvery(batchLength, whichBlocks);
          debug(`We have to fetch %o blocks, will do that in ${batches.length} batches`, whichBlocks);

          batchProcess(batchLength, whichBlocks.map(height => {
            const node = this._neoMesh.getBestNode();
            return () => pRetry(function () {
              return getBlock(node, height);
            }, {
              onFailedAttempt: error => {
                this._seekingSegment = false;
                debug(`Block attempt ${error.attemptNumber} failed. There are ${error.retriesLeft} retries left.`);
              },
              factor: 1.1,
              randomize: true
            }).then(async block => {

              debug(`which blocks length: ${whichBlocks.length} success count: ${successCount}`);
              if (this._blockRangeUpperBound) {
                if (block.index === this._blockRangeUpperBound.height) {
                  this._blockRangeUpperBound.hash = block.hash;
                }
              }

              if (this._blockRangeLowerBound) {
                if (block.index === this._blockRangeLowerBound.height) {
                  this._blockRangeLowerBound.hash = block.hash;
                }
              }
              debug(`whichBlocks.length ${whichBlocks.length} successCount ${successCount}`);
              if (!this._blockCache.has(block.index)) {
                this._blockCache.set(block.index, true);
                debug(`Fetched block with hash: ${block.hash}`);
                //const unifiedBlock = await createUnifiedBlock(this._config.isStandalone, block, this._rpc.rover, _createUnifiedBlock)
                createUnifiedBlock(this._config.isStandalone, block, this._rpc.rover, _createUnifiedBlock).then(unifiedBlock => {
                  if (!this._config.isStandalone) {
                    writeBlock(this._blockStream, unifiedBlock);
                  } else {
                    this._logger.info(`Rovered NEO block ${unifiedBlock.toObject ? inspect(unifiedBlock.toObject()) : inspect(unifiedBlock)}`);
                  }
                  successCount++;
                  if (successCount >= whichBlocks.length) {
                    this._logger.info('Initial sync finished');
                    this._timeoutResync = undefined;
                    this._seekingSegment = false;
                    this._rpc.rover.reportSyncStatus(new RoverSyncStatus(['neo', true]), (_, res) => {
                      this._seekingSegment = false;
                      logging.getLogger(__filename).info(`Status reported back successfully`);
                    });
                  } else {
                    debug(`${successCount} done, ${whichBlocks.length - successCount} to go`);
                  }
                });
                //if (!this._config.isStandalone) {
                //  const written = await writeBlock(this._blockStream, unifiedBlock)
                //  if (written) {
                //    debug('Wrote block %o to gRPC stream', unifiedBlock.getHeight())
                //  }
                //} else {
                //  this._logger.info(`Rovered NEO block ${unifiedBlock.getHeight()}, h: ${unifiedBlock.getHash()}`)
                //}
              }
            }).catch(err => {
              //this._logger.error(`critical error while getting new block height: ${height}, err: ${errToString(err)}`)
              this._seekingSegment = false;
            });
          }));
        });
      }, randomInt(1000, 2500));
    }
  }

  fetchBlock(previousLatest, currentLatest) {
    let from = previousLatest.getHeight();
    let to = currentLatest.getHeight();

    // if more than NEO_MAX_FETCH_BLOCKS would be fetch, limit this to save centralized chains
    if (to - from > NEO_MAX_FETCH_BLOCKS) {
      this._logger.warn(`Would fetch ${to - from} blocks but NEO can't handle such load, fetching only ${NEO_MAX_FETCH_BLOCKS}`);
      from = to - NEO_MAX_FETCH_BLOCKS;
    }
    const whichBlocks = range(from, to);

    if (from - to > 0) {
      this._logger.info(`Fetching missing blocks ${whichBlocks}`);
      const node = this._neoMesh.getBestNode();
      const loggerFn = this._logger.log.bind(this._logger);
      whichBlocks.forEach(height => {
        getBlock(node, height).then(block => {
          if (this._blockRangeUpperBound) {
            if (block.index === this._blockRangeUpperBound.height) {
              this._blockRangeUpperBound.hash = block.hash;
            }
          }

          if (this._blockRangeLowerBound) {
            if (block.index === this._blockRangeLowerBound.height) {
              this._blockRangeLowerBound.hash = block.hash;
            }
          }
          if (!this._blockCache.has(height)) {
            this._blockCache.set(height, true);
            debug(`Fetched block with hash: ${block.hash}`);
            debug(`Fetched block with hash: ${block.hash}`);
            this._logger.info(`rover transporting block : "${height}" : ${block.hash.slice(0, 21)}`);
            createUnifiedBlock(this._config.isStandalone, block, this._rpc.rover, partial(_createUnifiedBlock, [loggerFn])).then(unifiedBlock => {
              if (!this._config.isStandalone) {
                writeBlock(this._blockStream, unifiedBlock);
              } else {
                this._logger.info(`Rovered NEO block ${inspect(unifiedBlock)}`);
              }
            });
          }
        }, reason => {
          //this._logger.error(reason)
          throw new Error(reason);
        }).catch(err => {
          //this._rpc.rover.reportSyncStatus(new RoverSyncStatus(['neo', false]), function (_, res) {
          //  logging.getLogger(__filename).info(`synced = false status reported back successfully`)
          //})
          debug(`error while getting new block height: ${height}, err: ${errToString(err)}`);
        });
      });
    }
  }

  close() {
    ts.stop();
    this._blockStream.end();
    this._timeoutDescriptor && clearTimeout(this._timeoutDescriptor);
    this._networkRefreshIntervalDescriptor && clearInterval(this._networkRefreshIntervalDescriptor);
    this._checkFibersIntervalID && clearInterval(this._checkFibersIntervalID);
  }
}
exports.default = Controller;