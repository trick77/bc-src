'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports._createUnifiedBlock = _createUnifiedBlock;


const { inspect } = require('util'); /**
                                      * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
                                      *
                                      * This source code is licensed under the MIT license found in the
                                      * LICENSE file in the root directory of this source tree.
                                      *
                                      * 
                                      */

const EthereumBlock = require('ethereumjs-block');
//const EthereumTx = require('ethereumjs-tx').Transaction
const getRevertReason = require('eth-revert-reason');
const ethers = require('ethers');
const ethUtils = require('ethereumjs-util');
const InputDataDecoder = require('ethereum-input-data-decoder');
const BN = require('bn.js');
const { concat, contains } = require('ramda');
const debug = require('debug')('bcnode:rover:eth');

const logging = require('../../logger');
const { errToString } = require('../../helper/error');
const { networks, getIdStatus, getAddress } = require('../../config/networks');
const { Block, MarkedTransaction } = require('../../protos/core_pb');
const { RoverMessageType, RoverMessage, RoverIdent, RoverSyncStatus } = require('../../protos/rover_pb');
const { RpcClient } = require('../../rpc');
const { default: Network } = require('./network');
const roverHelp = require('../helper');
const { createUnifiedBlock } = require('../helper');
const { ERC20 } = require('./abi');
const { writeSafely, StandaloneDummyStream } = require('../utils');

const writeBlock = writeSafely('bcnode:rover:eth:controller');
const globalLog = logging.getLogger(__filename);
const BC_NETWORK = process.env.BC_NETWORK || 'main';
const EMB_CONTRACT_ADDRESS = networks[BC_NETWORK].rovers.eth.embContractId;
const DataDecoder = exports.DataDecoder = new InputDataDecoder(ERC20);
const ROVER_NAME = 'eth';
const txStatusPass = [];
const txStatusFail = [];

const ERC20_WATCHED_TOKENS = [{ assetName: 'emb', isEmb: true, contractAddress: EMB_CONTRACT_ADDRESS }, { assetName: 'dai', isEmb: false, contractAddress: '0x6b175474e89094c44da98b954eedeac495271d0f' }, // TODO pull to config
{ assetName: 'usdt', isEmb: false, contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7' }, // TODO pull to config
{ assetName: 'xaut', isEmb: false, contractAddress: '0x4922a015c4407f87432b179bb209e125432e4a2a' // TODO pull to config
}];

const getRandomFromList = (list, without) => {

  if (!list || list.length === 0) {
    return false;
  }

  const i = list[Math.floor(Math.random() * list.length)];
  if (!without || i !== without) {
    return i;
  } else {
    return getRandomFromList(list, without);
  }
};

const getTxStatus = async (mtxId, blockNumber) => {

  const list = getIdStatus();
  const cycle = async (addr, ids) => {

    if (!addr) {
      if (ids.length < 2) {
        throw new Error('unable to determine tx valid state');
      }
    }

    try {

      const pr = new ethers.providers.JsonRpcProvider(`${getAddress()}${addr}`);
      let txStatus = '';
      let reverted = false;

      if (txStatusPass.indexOf(mtxId) > -1) {
        reverted = false;
      } else if (txStatusFail.indexOf(mtxId) > -1) {
        reverted = true;
      } else {

        // its the first request
        if (ids.length === list.length) {
          txStatus = await getRevertReason(mtxId);
        } else {
          txStatus = await getRevertReason(mtxId, 'mainnet', blockNumber, pr);
        }

        reverted = '' !== txStatus && ' ' !== txStatus && txStatus;
        if (!reverted) {
          txStatusPass.push(mtxId);
        } else {
          txStatusFail.push(mtxId);
        }
      }

      return reverted;
    } catch (e) {

      if (ids.length < 2) {
        throw new Error('unable to determine tx valid state');
      }

      const remaining = ids.filter(l => {
        if (l !== addr) {
          return l;
        }
      });

      if (remaining.length === 0) {
        // tx is considered reverted
        return true;
      }

      return cycle(getRandomFromList(remaining), remaining);
    }
  };

  return cycle(getRandomFromList(list), list);
};

const markedTransactionToRef = function (markedTx) {
  return markedTx.getId() + markedTx.getToken() + markedTx.getAddrFrom() + markedTx.getAddrTo() + Buffer.from(markedTx.getValue()).toString('hex') + markedTx.getBlockHeight() + markedTx.getIndex() + markedTx.getHash();
};

const logger = logging.getLogger('rover.eth.controller.createUnifiedBlock', false);

async function _createUnifiedBlock(roverRpc, block, isStandalone, oldBlock = false) {

  return new Promise(async (resolve, reject) => {

    try {
      const d = block.toJSON({ labeled: true });
      debug(`controller map block #${parseInt(d.header.number, 16)} txs: ${d.transactions.length}`);
      const obj = {
        blockNumber: parseInt(d.header.number, 16),
        prevHash: d.header.parentHash,
        blockHash: '0x' + block.hash().toString('hex'),
        root: d.header.stateRoot,
        nonce: parseInt(d.header.nonce, 16),
        timestamp: parseInt(d.header.timestamp, 16) * 1000,
        difficulty: parseInt(d.header.difficulty, 16),
        coinbase: d.header.coinbase,
        marked: false
      };

      const msg = new Block();
      msg.setBlockchain(ROVER_NAME);
      msg.setHash(obj.blockHash);
      msg.setPreviousHash(obj.prevHash);
      msg.setTimestamp(obj.timestamp);
      msg.setHeight(obj.blockNumber);
      msg.setMerkleRoot(obj.root);

      // console.log(`#${block.transactions.length} Transactions for ${obj.blockHash}`)

      let emblemTransactions = [];
      const settlementChecks = [];
      const totalBlockTxs = block && block.transactions ? block.transactions.length : 0;
      while (block && block.transactions && block.transactions.length > 0) {
        const tx = block.transactions.shift();
        try {
          const serializedTx = tx.toJSON(true);
          const txId = ethUtils.bufferToHex(tx.hash(true));

          let decodedInput = DataDecoder.decodeData(serializedTx.data);
          let isEmbTx = false;
          let addrTo;
          let amount;
          let tokenType;

          for (let _ref of ERC20_WATCHED_TOKENS) {
            let { assetName, isEmb, contractAddress } = _ref;

            debug(`Token check ${assetName}, method: ${decodedInput.method}, contractAddress: ${ethUtils.bufferToHex(tx.to).toLowerCase()}`);
            if (decodedInput.method === 'transfer' && ethUtils.bufferToHex(tx.to).toLowerCase() === contractAddress) {
              let [to, transferAmount] = decodedInput.inputs;
              if (to && !to.startsWith('0x')) {
                to = `0x${to}`;
              }
              debug(`Token check matched, addrTo: ${to}, amount: ${transferAmount.toString(10)}, tokenType: ${assetName}, isEmbTx: ${isEmb}`);
              addrTo = to;
              amount = transferAmount;
              tokenType = assetName;
              isEmbTx = isEmb;

              break; // do not continue checking - we found the matching contract so it won't be any other one
            }
          }

          const addrFrom = ethUtils.bufferToHex(tx.from);
          addrTo = addrTo || ethUtils.bufferToHex(tx.to).toLowerCase();
          amount = amount || tx.value;
          const value = new BN(amount, 16).toBuffer();
          const bridgedChain = ROVER_NAME;
          const blockHeight = msg.getHeight();
          tokenType = tokenType || ROVER_NAME;

          // if EMB token also store to emblemTransactions array
          if (isEmbTx) {
            const mTx = new MarkedTransaction();
            mTx.setId(ROVER_NAME);
            mTx.setToken(tokenType);
            mTx.setAddrFrom(addrFrom);
            mTx.setAddrTo(addrTo);
            mTx.setValue(new Uint8Array(value));
            mTx.setBlockHeight(blockHeight);
            mTx.setIndex(emblemTransactions.length);
            mTx.setHash(txId);
            emblemTransactions.push(mTx);
          }

          if (txStatusFail.length > 4000) {
            txStatusFail.shift();
          }

          if (txStatusPass.length > 4000) {
            txStatusPass.shift();
          }

          // even if EMB, check for settlement
          settlementChecks.push([addrFrom, addrTo, value, bridgedChain, txId, blockHeight, tokenType]);

          debug(`check: ${inspect(addrFrom)}, ${inspect(addrTo)}, ${inspect(value)}, ${inspect(bridgedChain)}, ${inspect(txId)}, ${inspect(blockHeight)}, ${inspect(tokenType)}`);
        } catch (e) {
          console.trace(e);
          logger.info(`unable to parse TX's ${ethUtils.bufferToHex(tx.hash(true))}`);
          debug(e);
        }
      }

      debug('before settle check');
      let markedTransactions = (await roverHelp.isBeforeSettleHeight(settlementChecks, roverRpc, obj.blockHash)) || [];
      let failedMarkedIds = [];
      let finalMarkedTransactions = [];
      debug(`markedTransactions length: ${markedTransactions.length}`);

      // filter out those EMB transactions which were part of the trade and only add those
      // which were on neither side of the trade but we still have to track it
      if (!markedTransactions) {
        markedTransactions = [];
      }

      if (!oldBlock) {
        for (let mt of markedTransactions) {
          try {
            const mtxId = mt.getId();
            const reverted = await getTxStatus(mtxId, obj.blockNumber);

            // if not reverted add the marked transaction to final marketd transactions
            if (!reverted) {
              finalMarkedTransactions.push(mt);
            } else {
              failedMarkedIds.push(mtxId);
            }
          } catch (e) {
            logger.warn('critical error establishing id');
            logger.error(e);
            process.exit();
          }
        }
      } else {
        finalMarkedTransactions = markedTransactions;
      }

      if (markedTransactions.length !== finalMarkedTransactions.length) {
        logger.warn(`marked txs: ${finalMarkedTransactions.length}, failed marked txs: ${failedMarkedIds.length}`);
        logger.warn(JSON.stringify(failedMarkedIds.join('\n')));
      }

      const markedTransactionsRefs = finalMarkedTransactions.map(markedTransactionToRef);
      emblemTransactions = emblemTransactions.filter(function (potentialEmbTx) {
        return !contains(markedTransactionToRef(potentialEmbTx), markedTransactionsRefs);
      });

      // if some marked transactions came from settlement check, we have to reindex emblem transactions
      if (finalMarkedTransactions.length > 0) {
        for (var j = 0; j < emblemTransactions.length; j++) {
          emblemTransactions[j].setIndex(finalMarkedTransactions.length + j);
        }
      }

      markedTransactions = concat(finalMarkedTransactions, emblemTransactions);

      debug(`adding ${finalMarkedTransactions.length} marked eth transactions for ${obj.blockNumber} - ${obj.blockHash}`);

      msg.setBlockchain('eth');
      msg.setHash(obj.blockHash);
      msg.setPreviousHash(obj.prevHash);
      msg.setTimestamp(obj.timestamp);
      msg.setHeight(obj.blockNumber);
      msg.setMerkleRoot(obj.root);
      msg.setMarkedTxsList(markedTransactions);
      msg.setMarkedTxCount(markedTransactions.length);
      return resolve(msg);
    } catch (e) {
      console.trace(e);
      return reject(e);
    }
  });
}

/**
 * ETH Controller
 */
class Controller {

  constructor(isStandalone) {
    this._dpt = false;
    this._lastBlockCache = "";
    this._rpc = new RpcClient();
    if (isStandalone) {
      this._blockStream = new StandaloneDummyStream(__filename);
    } else {
      this._blockStream = this._rpc.rover.collectBlock(function (err, status) {
        if (err) {
          globalLog.error(`Error while writing to stream ${err.stack}`);
        }
      });
    }
    this._logger = logging.getLogger(__filename);
    this._isStandalone = isStandalone;
  }

  get network() {
    return this._network;
  }

  async transmitNewBlock(block, isBlockFromInitialSync = false) {
    const unifiedBlock = await createUnifiedBlock(this._isStandalone, block, this._rpc.rover, _createUnifiedBlock, isBlockFromInitialSync);
    this._logger.info(`rover transporting block : "${unifiedBlock.getHeight()}" : ${unifiedBlock.getHash().slice(0, 21)}`);
    if (this._lastBlockCache === unifiedBlock.getHash()) {
      this._network.emit('compressBlock', block);
      return;
    } else {
      this._lastBlockCache = unifiedBlock.getHash();
    }
    if (!this._isStandalone) {
      writeBlock(this._blockStream, unifiedBlock);
      this._network.emit('compressBlock', block);
    } else {
      debug(`collected new ETH block: ${unifiedBlock.toObject()}`);
    }
    return Promise.resolve(true);
  }

  start(config) {
    var network = new Network(config);
    network.on('newBlock', ({ block, isBlockFromInitialSync }) => this.transmitNewBlock(block, isBlockFromInitialSync));
    network.on('reportSyncStatus', status => {
      this._logger.info(`reporting rover sync: ${JSON.stringify(status, null, 2)}`);
      this._rpc.rover.reportSyncStatus(new RoverSyncStatus(['eth', status]), (err, res) => {
        this._logger.info(`status reported back successfully`);
      });
    });
    network.on('roverBlockRange', blockRange => {
      debug(`reporting block range: ${JSON.stringify(blockRange, null, 2)}`);
      const msg = new RoverMessage();
      const payload = new RoverMessage.RoverBlockRange([blockRange.roverName, blockRange.highestHeight, blockRange.lowestHeight, blockRange.highestHash, blockRange.lowestHash]);
      msg.setType(RoverMessageType.ROVER_BLOCK_RANGE);
      msg.setRoverBlockRange(payload);
      this._rpc.rover.reportBlockRange(payload, (_, res) => {
        debug(`block range reported successfully`);
      });
    });
    network.connect();

    this._network = network;
  }

  init(config) {
    this.start(config);

    process.on('disconnect', () => {
      this._logger.info('parent sent disconnect event');
      process.exit();
    });

    process.on('uncaughtException', e => {
      this._logger.error(`uncaught exception: ${errToString(e)}`);
    });

    const rpcStream = this._rpc.rover.join(new RoverIdent(['eth']));
    rpcStream.on('error', err => {
      this._logger.error(err);
    });
    rpcStream.on('data', message => {
      debug(`rpcStream: Received ${JSON.stringify(message.toObject(), null, 2)}`);
      switch (message.getType()) {// Also could be message.getPayloadCase()
        case RoverMessageType.REQUESTRESYNC:
          this.network.initialResync = true;
          this.network.resyncData = message.getResync();
          break;

        case RoverMessageType.FETCHBLOCK:
          const payload = message.getRoverBlockRange();
          this.network.requestBlockRange([payload.getToBlock(), payload.getFromBlock()]);
          break;

        case RoverMessageType.ROVER_BLOCK_RANGE:
          const data = message.getRoverBlockRange();
          this.network.engineSynced = data.getSynced();
          debug(`open block range request arrived engine sync status <- ${data.getSynced()}`);
          this.network.requestBlockRange([data.getHighestHeight(), data.getLowestHeight()]);
          break;

        default:
          this._logger.warn(`unknown message type ${message.getType()}`);
      }
    });
    rpcStream.on('close', () => this._logger.info(`gRPC stream from server closed`));
  }

  close() {
    this.network.close();
  }
}
exports.default = Controller;