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
const EthereumTx = require('ethereumjs-tx').Transaction;
const ethUtils = require('ethereumjs-util');
const InputDataDecoder = require('ethereum-input-data-decoder');
const BN = require('bn.js');
const { concat, contains } = require('ramda');
const debug = require('debug')('bcnode:rover:eth');

const logging = require('../../logger');
const { errToString } = require('../../helper/error');
const { networks } = require('../../config/networks');
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

const ERC20_WATCHED_TOKENS = [{ assetName: 'emb', isEmb: true, contractAddress: EMB_CONTRACT_ADDRESS }, { assetName: 'dai', isEmb: false, contractAddress: '0x6b175474e89094c44da98b954eedeac495271d0f' }, // TODO pull to config
{ assetName: 'usdt', isEmb: false, contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7' }, // TODO pull to config
{ assetName: 'xaut', isEmb: false, contractAddress: '0x4922a015c4407f87432b179bb209e125432e4a2a' // TODO pull to config
}];

const markedTransactionToRef = function (markedTx) {
  return markedTx.getId() + markedTx.getToken() + markedTx.getAddrFrom() + markedTx.getAddrTo() + Buffer.from(markedTx.getValue()).toString('hex') + markedTx.getBlockHeight() + markedTx.getIndex() + markedTx.getHash();
};

const logger = logging.getLogger('rover.eth.controller.createUnifiedBlock', false);
async function _createUnifiedBlock(roverRpc, block, isStandalone) {
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

  let emblemTransactions = [];
  const settlementChecks = [];
  // for (let tx of block.transactions) {
  while (block.transactions.length > 0) {
    const tx = block.transactions.shift();
    try {
      const serializedTx = tx.toJSON(true);

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
      const txId = ethUtils.bufferToHex(tx.hash(true));
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

      // even if EMB token, check for settlement
      settlementChecks.push([addrFrom, addrTo, value, bridgedChain, txId, blockHeight, tokenType]);
      debug(`check: ${inspect(addrFrom)}, ${inspect(addrTo)}, ${inspect(value)}, ${inspect(bridgedChain)}, ${inspect(txId)}, ${inspect(blockHeight)}, ${inspect(tokenType)}`);
    } catch (e) {
      logger.warn(`unable to parse TX's ${ethUtils.bufferToHex(tx.hash(true))} input data, ${e.stack}`);
    }
  }

  try {
    debug('before settle check');
    let markedTransactions = await roverHelp.isBeforeSettleHeight(settlementChecks, roverRpc);
    debug(`markedTransactions length: ${markedTransactions.length}`);

    // filter out those EMB transactions which were part of the trade and only add those
    // which were on neither side of the trade but we still have to track it
    if (!markedTransactions) {
      markedTransactions = [];
    }
    const markedTransactionsRefs = markedTransactions.map(markedTransactionToRef);
    emblemTransactions = emblemTransactions.filter(function (potentialEmbTx) {
      return !contains(markedTransactionToRef(potentialEmbTx), markedTransactionsRefs);
    });

    // if some marked transactions came from settlement check, we have to reindex emblem transactions
    if (markedTransactions.length > 0) {
      for (var j = 0; j < emblemTransactions.length; j++) {
        emblemTransactions[j].setIndex(markedTransactions.length + j);
      }
    }

    markedTransactions = concat(markedTransactions, emblemTransactions);

    debug(`adding ${markedTransactions.length} marked eth transactions`);

    msg.setBlockchain('eth');
    msg.setHash(obj.blockHash);
    msg.setPreviousHash(obj.prevHash);
    msg.setTimestamp(obj.timestamp);
    msg.setHeight(obj.blockNumber);
    msg.setMerkleRoot(obj.root);
    msg.setMarkedTxsList(markedTransactions);
    msg.setMarkedTxCount(markedTransactions.length);
    return Promise.resolve(msg);
  } catch (e) {
    console.trace(e);
    return Promise.reject(e);
  }
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
    // this._logger.info(`transmitNewBlock(), ${parseInt(block.header.number.toString('hex'), 16)}, isBlockFromInitialSync: ${isBlockFromInitialSync}`)
    const unifiedBlock = await createUnifiedBlock(this._isStandalone, block, this._rpc.rover, _createUnifiedBlock);
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