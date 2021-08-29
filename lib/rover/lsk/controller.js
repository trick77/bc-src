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
const { inspect } = require('util');
const LRUCache = require('lru-cache');
const request = require('request');
const querystring = require('querystring');
const lisk = require('@liskhq/lisk-client');
const liskCryptography = require('@liskhq/lisk-cryptography');
const { concat, flatten, isEmpty, merge, range, min, max } = require('ramda');
const pRetry = require('p-retry');
const BN = require('bn.js');
const debugFactory = require('debug');
const debug = debugFactory('bcnode:rover:lsk:controller');

const { Block, MarkedTransaction } = require('../../protos/core_pb');
const { SettleTxCheckReq, RoverMessage, RoverMessageType, RoverIdent, RoverSyncStatus } = require('../../protos/rover_pb');
const logging = require('../../logger');
const { networks } = require('../../config/networks');
const { errToString } = require('../../helper/error');
const { RpcClient } = require('../../rpc');
const { blake2b } = require('../../utils/crypto');
const { parseBoolean } = require('../../utils/config');
const { createUnifiedBlock } = require('../helper');
const roverHelp = require('../helper');
const { StandaloneDummyStream, ROVER_RESYNC_PERIOD, ROVER_SECONDS_PER_BLOCK, writeSafely, batchProcess } = require('../utils');
const { rangeStep } = require('../../utils/ramda');
const writeBlock = writeSafely('bcnode:rover:lsk:controller');

let skip = [];
let latency = 0;

// const BC_NETWORK = process.env.BC_NETWORK || 'main'
const BC_NETWORK = 'main';
const LSK_GENESIS_DATE = new Date('2016-05-24T17:00:00.000Z');
const LSK_MAX_FETCH_BLOCKS = 6;
const LSK_EMB_DESIGNATED_WALLET_PUBKEY = networks[process.env.BC_NETWORK || 'main'].rovers.lsk.embAssetId;
const ROVER_NAME = 'lsk';
const BC_MINER_BOOT = parseBoolean(process.env.BC_MINER_BOOT); // initialize new super collider

const getRandomRange = (min, max, num) => {
  if (!num) {
    num = 1;
  }
  return Math.floor((Math.random() * (max - min + 1) + min) / num);
};

const isIterable = obj => {
  if (obj == null) {
    return false;
  }
  return typeof obj[Symbol.iterator] === 'function';
};

const getMerkleRoot = block => {
  if (!block.transactions || block.transactions.length === 0) {
    return blake2b(block.blockSignature);
  }

  const txs = block.transactions.map(tx => tx.id);
  if (!txs) {
    return false;
  }
  return txs.reduce((acc, el) => blake2b(acc + el), '');
};

const getAbsoluteTimestamp = blockTs => {
  return ((LSK_GENESIS_DATE.getTime() / 1000 << 0) + blockTs) * 1000;
};

async function _createUnifiedBlock(roverRpc, block, isStandalone) {
  // TODO specify block type
  const gmr = getMerkleRoot(block);
  if (!gmr) {
    return Promise.reject(new Error(`unable to create block <- malformed data`));
  }
  if (!block.transactions) {
    debug(`given block has no transactions`);
    return Promise.resolve(false);
  }
  const obj = {
    blockNumber: block.height,
    prevHash: block.previousBlockId,
    blockHash: block.id,
    root: getMerkleRoot(block),
    fee: block.totalFee,
    size: block.payloadLength,
    generator: block.generatorId,
    generatorPublicKey: block.generatorPublicKey,
    blockSignature: block.blockSignature,
    confirmations: block.confirmations,
    totalForged: block.totalForged,
    timestamp: getAbsoluteTimestamp(parseInt(block.timestamp, 10)),
    version: block.version,
    transactions: block.transactions.reduce(function (all, t) {
      all.push({
        txHash: t.id,
        // inputs: t.inputs,
        // outputs: t.outputs,
        marked: false
      });
      return all;
    }, [])

    // console.log({obj})

    // debug({block})
  };const msg = new Block();
  msg.setBlockchain(ROVER_NAME);
  msg.setHash(obj.blockHash);
  msg.setPreviousHash(obj.prevHash);
  msg.setTimestamp(obj.timestamp);
  msg.setHeight(obj.blockNumber);
  msg.setMerkleRoot(obj.root);

  debug(`lsk controller() _createUnifiedBlock(): processing height ${msg.getHeight()}`);

  const emblemTransactions = [];
  const settlementChecks = [];
  for (let tx of block.transactions) {
    // for type docs see https://lisk.io/documentation/lisk-protocol/transactions
    let isEmbTx = LSK_EMB_DESIGNATED_WALLET_PUBKEY !== null && tx.type === 0 && tx.senderPublicKey === LSK_EMB_DESIGNATED_WALLET_PUBKEY;

    // debug({tx})
    let addrFrom = undefined;
    let addrTo = undefined;
    let value = undefined;
    // see https://github.com/LiskHQ/lips/blob/master/proposals/lip-0028.md and https://github.com/LiskHQ/lips/blob/master/proposals/lip-0012.md
    if (tx.type === 8) {
      addrFrom = liskCryptography.getBase32AddressFromPublicKey(Buffer.from(senderPublicKey, 'hex'));
      addrTo = tx.asset.recipientAddress;
      value = new BN(tx.asset.amount).toBuffer();
    } else {
      addrFrom = tx.senderId;
      addrTo = tx.recipientId;
      value = new BN(tx.amount).toBuffer();
    }
    const bridgedChain = ROVER_NAME;
    const txId = tx.id;
    const blockHeight = msg.getHeight();
    const tokenType = isEmbTx ? 'emb' : ROVER_NAME;

    if (isEmbTx) {
      let ttx = new MarkedTransaction();
      ttx.setId(bridgedChain);
      ttx.setToken(tokenType);
      ttx.setAddrFrom(addrFrom);
      ttx.setAddrTo(addrTo);
      // actual lisk amount value is parseFloat(tx.amount, 10) / 100000000
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
      // debug(`${JSON.stringify({addrFrom, addrTo, value, bridgedChain, txId, blockHeight, tokenType})}`)
    }
  }

  try {
    let markedTransactions = (await roverHelp.isBeforeSettleHeight(settlementChecks, roverRpc, obj.blockHash, 'lsk')) || [];

    // if some marked transactions came from settlement check, we have to reindex emblem transactions
    if (markedTransactions && markedTransactions.length > 0) {
      for (var i = 0; i < emblemTransactions.length; i++) {
        emblemTransactions[i].setIndex(markedTransactions.length + i);
      }
    }

    markedTransactions = concat(markedTransactions, emblemTransactions);

    const queuedMarkedTransactions = (await roverHelp.getQueuedMarkedTxs(markedTransactions, roverRpc, obj.blockHash, 'lsk')) || [];

    msg.setMarkedTxsList(markedTransactions);
    msg.setMarkedTxCount(markedTransactions.length);

    return msg;
  } catch (e) {
    //console.trace(e)
  }
}

/**
 * LSK Controller
 */
class Controller {

  constructor(config) {
    this._config = config;
    this._ranCycle = false;
    this._highestBlockHeight = 0;
    this._seekingBlockSegment = false;
    this._logger = logging.getLogger(__filename);
    this._blockCache = new LRUCache({
      max: 25000,
      maxAge: 1000 * 60 * 60
    });
    this._rangeToFetch = [];
    this._shutdownTimer = setTimeout(() => {
      this._logger.error(new Error(`unable to reach LISK "decentralized" network. Restarting...`));
      process.exit();
    }, 90000);
    this._fetchCache = new LRUCache({ max: 250 });
    // TODO pull this to networks config
    const networkConfig = merge(config, { testnet: BC_NETWORK === 'test', randomizeNodes: true, bannedPeers: [] });
    debug('network config: %O', networkConfig);
    const peers = ['http://service.lisk.io', 'http://hub21.lisk.io', 'https://hub22.lisk.io:443', 'http://hub23.lisk.io', 'http://hub24.lisk.io', 'https://hub25.lisk.io:443', 'https://hub26.lisk.io:443', 'https://hub27.lisk.io:443', 'https://hub28.lisk.io:443', 'https://hub31.lisk.io', 'https://hub32.lisk.io', 'https://hub33.lisk.io:443', 'https://hub34.lisk.io:443', 'https://hub35.lisk.io:443', 'https://hub36.lisk.io:443', 'https://hub37.lisk.io', 'https://hub38.lisk.io', 'https://node01.lisk.io:443', 'https://node02.lisk.io:443', 'https://node03.lisk.io:443', 'https://node04.lisk.io:443', 'https://node05.lisk.io:443', 'https://node06.lisk.io:443', 'https://node08.lisk.io:443'];

    lisk.APIClient.constants.MAINNET_NODES = peers;
    this._liskApi = BC_NETWORK === 'test' ? lisk.APIClient.createTestnetAPIClient(networkConfig) : lisk.APIClient.createMainnetAPIClient(networkConfig);

    this._rpc = new RpcClient();

    if (this._config.isStandalone) {
      this._blockStream = new StandaloneDummyStream(__filename);
    } else {
      debug('Creating real rpc stream');
      this._blockStream = this._rpc.rover.collectBlock((err, status) => {
        if (err) {
          debug(`rover.collectBlock() err %O`, err);
          this._logger.error(`Error while writing to stream ${err.stack}`);
        }

        this._logger.info(`RPC stream closed, stats: ${status.toObject()}`);
      });
    }
  }

  init() {
    debug('initialized');

    process.on('disconnect', () => {
      this._logger.info('Parent exited');
      process.exit();
    });

    process.on('uncaughtException', e => {
      this._logger.error(`Uncaught exception: ${errToString(e)}`);
      process.exit(3);
    });

    const rpcStream = this._rpc.rover.join(new RoverIdent(['lsk']));
    rpcStream.on('data', message => {
      debug(`rpcStream: Received ${JSON.stringify(message.toObject(), null, 2)}`);
      switch (message.getType()) {// Also could be message.getPayloadCase()
        case RoverMessageType.REQUESTRESYNC:
          debug(`Got resync message %O`, message.getResync().toObject());
          this.startResync(message.getResync());
          break;

        case RoverMessageType.LATESTBLOCK:
          this._logger.info(`latest block received from manager`);
          break;

        case RoverMessageType.FETCHBLOCK:
          const payload = message.getFetchBlock();
          const fromBlock = payload.getFromBlock();
          const toBlock = payload.getToBlock();
          this.fetchBlock(payload.getFromBlock(), payload.getToBlock());
          break;

        case RoverMessageType.ROVER_BLOCK_RANGE:
          // DEBUG
          debug(`open block range request arrived`);
          const data = message.getRoverBlockRange();
          this.requestBlockRange([data.getHighestHeight(), data.getLowestHeight()]);
          break;

        default:
          this._logger.warn(`Got unknown message type ${message.getType()}`);
      }
    });
    rpcStream.on('close', () => {
      this._logger.info(`gRPC stream from server closed`);
    });

    this._cycleFn = getOpts => {
      //const hasNodes = this._liskApi.hasAvailableNodes()
      //if (hasNodes) {
      //  // DEBUG
      //  this._logger.info(`connection open: ${hasNodes}, window: ${Number(latency / 1000).toFixed(2)}s`)
      //} else {
      //  this._logger.warn(`restarting rover to rebuild network connections`)
      //  process.exit()
      //}
      this._seekingBlockSegment = true;
      const o = getOpts && getOpts.offset ? getOpts : { offset: 0, limit: 1 };
      return this._request('blocks', o).then(async lastBlocks => {
        let errorOccured = false;
        try {
          let blocks;
          if (lastBlocks.blocks !== undefined) {
            blocks = lastBlocks.blocks;
          } else {
            blocks = lastBlocks.data;
          }

          if (!blocks) {
            return Promise.reject(true);
          }

          if (this._shutdownTimer) {
            clearTimeout(this._shutdownTimer);
            this._shutdownTimer = undefined;
          }
          try {
            debug(`processing ${blocks.length}`);
            while (blocks.length > 0) {
              const lastBlock = blocks.shift();
              if (this._highestBlockHeight < lastBlock.height) {
                this._highestBlockHeight = lastBlock.height;
              }
              if (!this._blockCache.has(lastBlock.id) || this._fetchCache.has(lastBlock.height)) {
                this._blockCache.set(lastBlock.id, true);
                debug(`unseen block with id: ${inspect(lastBlock.id)} => using for BC chain`);

                let startTime = Date.now();
                const data = await this._request('transactions', { blockId: lastBlock.id });
                if (!data) {
                  if (blocks.length > 1) {
                    blocks.push(lastBlock);
                  }
                  break;
                }
                if (data.data) {
                  lastBlock.transactions = data.data;
                } else {
                  lastBlock.transactions = data;
                }
                latency = Date.now() - startTime;

                if (!Array.isArray(lastBlock.transactions)) {
                  return Promise.resolve(true);
                }

                if (this._blockRangeUpperBound && this._blockRangeUpperBound.height === lastBlock.height) {
                  //this._blockRangeUpperBound.hash = lastBlock.id
                } else if (this._blockRangeLowerBound && this._blockRangeLowerBound.height === lastBlock.height) {
                  //this._blockRangeLowerBound.hash = lastBlock.id
                }

                const unifiedBlock = await createUnifiedBlock(this._config.isStandalone, lastBlock, this._rpc.rover, _createUnifiedBlock);
                if (!unifiedBlock) {
                  return false;
                }

                debug('LSK Going to call this._rpc.rover.collectBlock()');
                if (!this._config.isStandalone) {
                  this._logger.info(`rover transporting block : "${unifiedBlock.getHeight()}" : ${unifiedBlock.getHash().slice(0, 21)}`);
                  writeBlock(this._blockStream, unifiedBlock);
                  this._fetchCache.del(lastBlock.height);
                } else {
                  this._logger.info(`Rovered ${unifiedBlock.getHeight()} LSK block`);
                }
                return Promise.resolve(true);
              }
            }
          } catch (err) {
            skip = skip.concat(['1', '1']);
            //console.trace(err)
            this._logger.error(err);
            return Promise.reject(err);
          }
          this._seekingBlockSegment = false;
          if (this._blockRangeLowerBound && this._blockRangeLowerBound.hash && this._blockRangeUpperBound.hash && !this._seekingBlockSegment) {
            this.setBlockRange();
          }
        } catch (err) {
          if (skip.length < 3) {
            skip.push('1');
          }
          this._logger.error(err);
          errorOccured = err;
        }
        return errorOccured ? Promise.reject(errorOccured) : Promise.resolve(true);
      }).catch(err => {
        if (skip.length < 5) {
          skip.push('1');
        }
        debug(err);
        debug('connection lsk network error');
        this._seekingBlockSegment = false;
        //this._rpc.rover.reportSyncStatus(new RoverSyncStatus(['lsk', false]), (_, res) => {
        //  this._logger.info(`sync status reported as false`)
        //})
      });
    };

    debug('tick');
    const rateOfReq = BC_MINER_BOOT ? 9000 : getRandomRange(2000, 3000);
    this._intervalDescriptor = setInterval(() => {
      if (skip.length > 0) {
        let t = 'seconds';
        let estTime = 2.1 * skip.length;

        if (estTime > 120) {
          t = 'minutes';
          estTime = parseFloat(estTime / 60).toFixed(1);
        } else {
          estTime = parseFloat(estTime).toFixed(1);
        }

        this._logger.info(`flushing request pool <-  ${skip.length} remaining est. ${estTime} ${t}`);
        skip.pop();
      } else {
        this._cycleFn().then(() => {
          debug('tick');
        });
      }
    }, rateOfReq);
  }

  async _httpApi(method, opts, data) {
    let qs = "";
    if (opts) {
      qs = querystring.stringify(opts);
    }
    if (qs && qs.length > 2) {
      qs = '?' + qs;
    } else {
      qs = "";
    }
    const urls = ['http://95.179.150.150:8000/api/', 'http://192.99.228.99:8000/api/', 'http://104.237.9.142:8000/api/', 'http://104.238.167.150:8000/api/', 'http://116.203.63.37:8000/api/', 'http://116.203.73.30:8000/api/', 'http://157.90.168.16:8000/api/', 'http://159.69.154.132:8000/api/', 'http://160.16.139.105:8000/api/', 'http://192.154.224.145:7000/api/', 'http://192.99.228.99:8000/api/', 'http://2.56.213.101:8000/api/', 'http://23.88.45.135:8000/api/', 'http://5.9.99.62:8000/api/', 'http://51.158.182.3:4000/api/', 'http://78.46.147.196:8000/api/', 'http://80.240.30.26:8000/api/', 'http://95.179.150.150:8000/api/'];
    const baseUrl = urls[urls.length * Math.random() | 0];
    const url = baseUrl + method + qs;
    debug(`requesting network ${method} <- ${url}`);
    return new Promise((resolve, reject) => {
      request({
        url: url,
        json: true
      }, function (err, response, body) {
        if (err) {
          reject(err);
        } else {
          if (body.body) {
            return resolve(body.body);
          } else {
            return resolve(body);
          }
        }
      });
    });
  }

  async _request(method, opts) {
    // https://node.lisk.io/api/accounts/15940139821979836223L/multisignature_groups
    // return this._liskApi.transactions.get({ blockId: lastBlock.id }).then(async ({ data }) => {
    // return this._liskApi.blocks.get({ offset: calculatedOffset, limit }).then(lastBlocks => {
    // https://node.lisk.io/api/blocks?limit=10&offset=0&sort=height%3Adesc
    if (method === 'blocks') {
      return new Promise((resolve, reject) => {
        if (!opts) {
          return this._liskApi.blocks.get().then(lastBlocks => {
            try {
              let blocks = lastBlocks.data ? lastBlocks.data : lastBlocks.blocks;
              for (let b of blocks) {
                // do nothing
              }
              return resolve(lastBlocks);
            } catch (err) {
              return this._httpApi('blocks').then(lastBlocks => {
                return resolve(lastBlocks);
              }).catch(err => {
                return reject(err);
              });
            }
          }).catch(err => {
            return this._httpApi('blocks').then(lastBlocks => {
              return resolve(lastBlocks);
            }).catch(err => {
              return reject(err);
            });
          });
        } else {
          return this._liskApi.blocks.get(opts).then(lastBlocks => {
            try {
              let blocks = lastBlocks.data ? lastBlocks.data : lastBlocks.blocks;
              for (let b of blocks) {
                // do nothing
              }
              return resolve(lastBlocks);
            } catch (err) {
              return this._httpApi('blocks', opts).then(lastBlocks => {
                return resolve(lastBlocks);
              }).catch(err => {
                return reject(err);
              });
            }
            return resolve(lastBlocks);
          }).catch(err => {
            return this._httpApi('blocks', opts).then(lastBlocks => {
              return resolve(lastBlocks);
            }).catch(err => {
              return reject(err);
            });
          });
        }
      });
    } else if (method === 'transactions') {
      return new Promise((resolve, reject) => {
        if (!opts) {
          return this._liskApi.transactions.get().then(txs => {
            if (!txs || !Array.isArray(txs.data)) {
              return this._httpApi('transactions').then(txs => {
                return resolve(txs);
              }).catch(err => {
                return reject(err);
              });
            }
            return resolve(txs);
          }).catch(err => {
            return this._httpApi('transactions').then(txs => {
              return resolve(txs);
            }).catch(err => {
              return reject(err);
            });
          });
        } else {
          return this._liskApi.transactions.get(opts).then(txs => {
            if (!txs || !txs.data || !isIterable(txs.data)) {
              return this._httpApi('transactions', opts).then(txs => {
                return resolve(txs);
              }).catch(err => {
                return reject(err);
              });
            }
            return resolve(txs);
          }).catch(err => {
            return this._httpApi('transactions', opts).then(txs => {
              return resolve(txs);
            }).catch(err => {
              return reject(err);
            });
          });
        }
      });
    } else {
      this._logger.error(`unsupported request type ${method}`);
      return;
    }
  }

  startResync(resyncMsg) {
    this._request('blocks').then(lastBlocks => {
      // if (this._seekingBlockSegment) {
      // //  this._seekingB
      //  this._seekingBlockSegment = false
      //  return
      // }
      let lastBlockHeight;
      if (lastBlocks.blocks !== undefined) {
        lastBlockHeight = lastBlocks.blocks[0].height;
      } else if (lastBlocks.data !== undefined && lastBlocks.data.length > 0) {
        lastBlockHeight = lastBlocks.data[0].height;
      } else {
        this._logger.info(`no information recieved`);
        setTimeout(() => {
          return this.startResync(resyncMsg);
        }, 2000);
        return;
      }

      this._logger.info(`startResync() lastBlockHeight: ${lastBlockHeight}`);
      const taskDescriptors = [];
      this._seekingBlockSegment = true;

      if (resyncMsg && !isEmpty(resyncMsg.getIntervalsList())) {
        for (const interval of flatten(resyncMsg.getIntervalsList())) {
          const fromHeight = interval.getFromBlock().getHeight() - 5;
          const toHeight = interval.getToBlock().getHeight();
          if (toHeight - fromHeight - 1 > LSK_MAX_FETCH_BLOCKS) {
            debug(1111);
            const boundaries = rangeStep(fromHeight, LSK_MAX_FETCH_BLOCKS, toHeight);
            debug(`boundaries are %o`, boundaries);
            for (const boundary of boundaries) {
              taskDescriptors.unshift({ createdAtHeight: lastBlockHeight, offset: max(0, lastBlockHeight - boundary), limit: LSK_MAX_FETCH_BLOCKS + 1 });
            }
          } else {
            debug(`boundary ${fromHeight} - ${toHeight}`);
            taskDescriptors.push({ createdAtHeight: lastBlockHeight, offset: max(0, lastBlockHeight - toHeight), limit: max(toHeight - fromHeight, LSK_MAX_FETCH_BLOCKS) });
          }
        }
        // if known latest block is older than actual latest block, fetch /latestBlock - known latest block] interval too
        const knownLatestBlock = resyncMsg.getLatestBlock();
        if (knownLatestBlock && knownLatestBlock.getHeight() < lastBlockHeight) {
          debug(2222);
          const knownLatestBlockHeight = knownLatestBlock.getHeight();
          if (lastBlockHeight - knownLatestBlock - 1 > LSK_MAX_FETCH_BLOCKS) {
            const boundaries = rangeStep(knownLatestBlock, LSK_MAX_FETCH_BLOCKS, lastBlockHeight);
            debug(`last blocks diff boundaries are %o`, boundaries);
            for (const boundary of boundaries) {
              taskDescriptors.push({ createdAtHeight: lastBlockHeight, offset: max(0, lastBlockHeight - boundary), limit: LSK_MAX_FETCH_BLOCKS + 1 });
            }
          } else {
            debug(`knownLatestBlock is stale, getting boundary ${knownLatestBlockHeight} - ${lastBlockHeight}, length: ${lastBlockHeight - knownLatestBlockHeight}`);
            taskDescriptors.push({ createdAtHeight: lastBlockHeight, offset: max(0, lastBlockHeight - knownLatestBlockHeight), limit: max(lastBlockHeight - knownLatestBlockHeight, LSK_MAX_FETCH_BLOCKS) });
          }
        }
      } else if (this._rangeToFetch.length > 0) {
        debug(3333);
        const r = this._rangeToFetch.pop();
        const to = r[0];
        const from = r[1];
        const boundaries = rangeStep(from, LSK_MAX_FETCH_BLOCKS, to);
        this._blockRangeUpperBound = { height: to, hash: undefined };
        this._blockRangeLowerBound = { height: from, hash: undefined
          // DEBUG
        };this._logger.info(`requesting blocks from rangeToFetch from: ${from} to: ${to} (${to - from} blocks)`);
        debug('Sync data was empty, using stored ranges calculated boundaries %o', boundaries);
        for (const boundary of boundaries) {
          taskDescriptors.push({ createdAtHeight: lastBlockHeight, offset: max(1, lastBlockHeight - boundary), limit: LSK_MAX_FETCH_BLOCKS + 1 });
        }
      } else {
        debug(5555);
        const to = lastBlockHeight;
        const period = ROVER_RESYNC_PERIOD;
        //const period = 21600
        const from = to - (Math.floor(period / ROVER_SECONDS_PER_BLOCK['lsk']) - 2);
        const boundaries = rangeStep(from, LSK_MAX_FETCH_BLOCKS, to);
        debug('Sync data was empty, calculated boundaries %o', boundaries);
        for (const boundary of boundaries) {
          taskDescriptors.push({ createdAtHeight: lastBlockHeight, offset: max(1, lastBlockHeight - boundary), limit: LSK_MAX_FETCH_BLOCKS + 1 });
        }
        this._logger.info(`Requesting blocks ${from} - ${to} for initial resync (${taskDescriptors.length} tasks)`);
      }

      debug(`About to report sync status, pending %o tasks`, taskDescriptors.length);
      if (!isEmpty(taskDescriptors)) {
        debug(6666);
        debug(`synced = false status reporting to manager`);
        //this._rpc.rover.reportSyncStatus(new RoverSyncStatus([ROVER_NAME, false]), function (err, res) {
        //  if (err) {
        //    debug(`Error while reporing RoverSyncStatus: ${err}`)
        //    this._seekingBlockSegment = false
        //    return
        //  }
        //  debug(`synced = false status reported manager, result: %o`, res.toObject())
        //})
      }

      let successCount = 0;
      batchProcess(6, taskDescriptors.map(({ createdAtHeight, offset, limit }) => {
        return () => pRetry(() => {
          debug('startResync get block batch created at height %o offset %o limit %o', createdAtHeight, offset, limit);
          return this._request('blocks', { limit: 1, offset: 0 }).then(lastBlocks => {
            let currentLastBlockHeight;
            if (lastBlocks.blocks) {
              if (lastBlocks.blocks.length < 1) {
                return Promise.reject(new Error(`Lisk network unavailable`));
              }
              currentLastBlockHeight = lastBlocks.blocks[0].height;
            } else if (lastBlocks.data) {
              if (lastBlocks.data !== undefined && lastBlocks.data.length < 1) {
                return Promise.reject(new Error(`Lisk network unavailable`));
              }
              currentLastBlockHeight = lastBlocks.data[0].height;
            } else {
              return Promise.reject(new Error(`Lisk network unavailable`));
            }

            if (this._highestBlockHeight < currentLastBlockHeight) {
              this._highestBlockHeight = currentLastBlockHeight;
            }
            const calculatedOffset = offset + (currentLastBlockHeight - createdAtHeight) - 2;
            const batchDebug = debugFactory(`bcnode:rover:lsk:controller:batch-${currentLastBlockHeight - calculatedOffset}-${currentLastBlockHeight - calculatedOffset + limit}`);
            return this._request('blocks', { offset: calculatedOffset, limit }).then(lastBlocks => {

              try {
                let blocks;
                if (lastBlocks.blocks !== undefined) {
                  blocks = lastBlocks.blocks;
                  if (!blocks || !isIterable(blocks)) {
                    return Promise.reject(new Error(`Lisk network unavailable`));
                  }
                } else {
                  blocks = lastBlocks.data;
                  if (!blocks || !isIterable(blocks)) {
                    return Promise.reject(new Error(`Lisk network unavailable`));
                  }
                }

                batchDebug('startResync got block batch (%o blocks) offset %o limit %o (from-to %o-%o)', lastBlocks.blocks ? lastBlocks.blocks.length : lastBlocks.data.length, calculatedOffset, limit, currentLastBlockHeight - calculatedOffset, currentLastBlockHeight - calculatedOffset + limit);

                return Promise.all(blocks.map(lastBlock => {
                  //batchDebug('Collected new block height: %o, id: %o', lastBlock.height, lastBlock.id)
                  if (!this._blockCache.has(lastBlock.id) || this._fetchCache.has(lastBlock.height)) {
                    //batchDebug(`unseen block with height: %o, id: %o => using for BC chain`, lastBlock.height, lastBlock.id)
                    this._blockCache.set(lastBlock.id, true);

                    // if the block was in the fetch queue remove it
                    if (this._fetchCache.has(lastBlock.height)) {
                      this._fetchCache.del(lastBlock.height);
                    }

                    return this._request('transactions', { blockId: lastBlock.id }).then(async ({ data }) => {
                      try {
                        lastBlock.transactions = data;
                        debug('Got txs for block %o, id: %o, %o', lastBlock.height, lastBlock.id, data);
                        const unifiedBlock = await createUnifiedBlock(this._config.isStandalone, lastBlock, this._rpc.rover, _createUnifiedBlock);
                        if (!unifiedBlock) {
                          return false;
                        }
                        if (unifiedBlock && this._blockRangeUpperBound && this._blockRangeUpperBound.height === unifiedBlock.getHeight()) {
                          this._blockRangeUpperBound.hash = unifiedBlock.getHash();
                        } else if (unifiedBlock && this._blockRangeLowerBound && this._blockRangeLowerBound.height === unifiedBlock.getHeight()) {
                          this._blockRangeLowerBound.hash = unifiedBlock.getHash();
                        }
                        batchDebug('LSK Going to call this._rpc.rover.collectBlock() with block %o', lastBlock.height);
                        let written;
                        if (!this._config.isStandalone) {
                          written = writeBlock(this._blockStream, unifiedBlock);
                        } else {
                          this._logger.info(`Rovered ${unifiedBlock.getHeight()} LSK block`);
                        }
                        return Promise.resolve(true);
                      } catch (err) {
                        this._seekingBlockSegment = false;
                        this._logger.error(err);
                        return Promise.reject(err);
                      }
                    });
                  } else {
                    batchDebug('Block %o already seen, not sending again', lastBlock.id);
                    return Promise.resolve(false);
                  }
                }));
              } catch (err) {
                this._seekingBlockSegment = false;
                this._logger.error(err);
                return Promise.reject(err);
              }
            });
          });
        }, {
          //forever: true,
          //randomize: true,
          //factor: 1.1,
          maxRetryTime: 9900,
          forever: true,
          factor: 1.1,
          randomize: true,
          maxTimeout: 5000,
          onFailedAttempt: function (error) {
            debug(`Block interval task offset: ${offset}, limit: ${limit} attempt ${error.attemptNumber} failed.
There are ${error.retriesLeft} retries left.
Total: ${taskDescriptors.length}, success: ${successCount}`);
            if (error.retriesLeft < 1 && successCount !== taskDescriptors.length) {
              this._seekingBlockSegment = false;
              //this._rpc.rover.reportSyncStatus(new RoverSyncStatus(['lsk', true]), (_, res) => {
              //  this._seekingBlockSegment = false
              //  this._logger.info(`Status reported back successfully`)
              //})
            }
          }
        }).then(results => {
          debug(`Got result %o for interval task offset: ${offset}, limit: ${limit}`, results);
          successCount++;
          if (successCount === taskDescriptors.length) {
            this._seekingBlockSegment = false;
            this._timeoutResync = undefined;
            //if (resyncMsg) {
            this._logger.info(`Initial resync finished`);
            this._rpc.rover.reportSyncStatus(new RoverSyncStatus(['lsk', true]), (_, res) => {
              this._seekingBlockSegment = false;
              this._logger.info(`Status reported back successfully`);
            });
            //}
          } else {
            debug(`${successCount} done, ${taskDescriptors.length - successCount} to go`);
          }
        });
      })); // .then(results => debug('batchProcess() finished with results %o', results))
    });
    return Promise.resolve(true);
  }

  requestBlockRange(blockRange) {
    if (blockRange.length < 2) {
      this._logger.error(`invalid block range length submitted`);
      return;
    }
    const lowest = blockRange[1];
    const highest = min(blockRange[0], lowest + LSK_MAX_FETCH_BLOCKS);
    const r = [min(highest, lowest + LSK_MAX_FETCH_BLOCKS), lowest];

    if (highest < lowest || highest === lowest) {
      this._logger.warn(`ignoring malformed range request highest: ${highest} lowest: ${lowest}`);
      return;
    }

    if (this._rangeToFetch.length > 0) {
      const prevHigh = this._rangeToFetch[0][0];
      const prevLow = this._rangeToFetch[0][1];

      if (prevHigh < highest || prevLow > lowest) {
        // DEBUG
        debug(`updated block range prevHigh: ${prevHigh} -> highest: ${r[0]} prevLow: ${prevLow} -> lowest ${lowest}`);
        this._rangeToFetch.length = 0;
        this._rangeToFetch.push(r);
      }
    } else {
      debug(`pushing block range highest ${r[0]} lowest ${r[1]}`);
      this._rangeToFetch.length = 0;
      this._rangeToFetch.push(r);
    }

    if (this._rangeToFetch.length > 0) {
      const range = this._rangeToFetch.pop();
      const fromBlock = new Block();
      const toBlock = new Block();
      const from = range[1];
      let to = min(from + LSK_MAX_FETCH_BLOCKS, range[0]);
      if (to < from) {
        to = from + 1;
      }
      toBlock.setHeight(to);
      fromBlock.setHeight(from);
      //this.startResync()
      this.fetchBlock(toBlock, fromBlock);
    }
  }

  fetchBlock(currentLast, previousLast) {
    //if (this._seekingBlockSegment) {
    //  this._seekingBlockSegment = false
    //  return
    //}
    let from = previousLast.getHeight();
    let to = min(from + 10, parseInt(currentLast.getHeight(), 10));
    this._logger.info(`fetchBlock() from: ${from} to: ${to}`);
    for (let i = from; i <= to; i++) {
      this._fetchCache.set(i, true);
    }

    // if more than LSK_MAX_FETCH_BLOCKS would be fetch, limit this to save centralized chains
    if (to - from > LSK_MAX_FETCH_BLOCKS) {
      this._logger.warn(`would fetch ${to - from} blocks but LSK shouldn't handle that load, fetching only ${LSK_MAX_FETCH_BLOCKS}`);
    }
    const whichBlocks = range(from, to);
    if (to - from > 0) {
      // DEEBUG
      debug(`fetching missing blocks ${whichBlocks}`);
      const opts = { offset: max(0, this._highestBlockHeight - from) + 1, limit: 4 };
      this._cycleFn(opts).then(() => {
        // DEBUG
        debug(`Fetched missing blocks ${whichBlocks}`);
        this._seekingBlockSegment = false;
        //this._rpc.rover.reportSyncStatus(new RoverSyncStatus(['lsk', true]), (_, res) => {
        this._logger.info(`sync status reported as true`);
        //})
        //})
      });
    }
  }

  /*
   * ends the bounds of the block range ready for evaluation
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
      this._logger.info(`setting block range upper hash ${this._blockRangeUpperBound.hash} lower hash ${this._blockRangeLowerBound.hash}`);
      this._rangeToFetch.length = 0;
      const payload = new RoverMessage.RoverBlockRange(['lsk', this._blockRangeUpperBound.height, this._blockRangeLowerBound.height, this._blockRangeUpperBound.hash, this._blockRangeLowerBound.hash]);
      this._rpc.rover.reportBlockRange(payload, (_, res) => {
        debug(`block range reported successfully`);
      });
      // unsset the bounds allowing the bounds to be changed
      this._blockRangeUpperBound = undefined;
      this._blockRangeLowerBound = undefined;
      // else if the block heights have not been found and nothing is pending their to resume the search, put the heights into their own segment
    } else if (this._blockRangeUpperBound && this.BlockRangeLowerBound && this._rangeToFetch.length < 1) {
      if (!this._blockRangeUpperBound.hash || !this._blockRangeLowerBound.hash) {
        const highest = this._blockRangeUpperBound;
        this._rangeToFetch.push([highest, this._blockRangeLowerBound.height]);
      }
    }
    // only set block range if there are no requests waiting to be fetched
    if (nextRange && nextRange.length > 1 && this._rangeToFetch.length < 1) {
      this._blockRangeUpperBound = { height: nextRange[0], hash: false };
      this._blockRangeLowerBound = { height: nextRange[1], hash: false };
    }

    //if (this._rangeToFetch.length > 0) {
    //  this.startResync()
    //}
  }

  close() {
    this._blockStream.end();
    this._intervalDescriptor && clearInterval(this._intervalDescriptor);
  }
}
exports.default = Controller;