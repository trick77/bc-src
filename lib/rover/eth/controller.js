'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DataDecoder721 = exports.DataDecoder = undefined;
exports._createUnifiedBlock = _createUnifiedBlock;

var _common = require('@ethereumjs/common');

var _common2 = _interopRequireDefault(_common);

var _vm = require('@ethereumjs/vm');

var _vm2 = _interopRequireDefault(_vm);

var _tokens = require('./tokens');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const { inspect } = require('util');
const EthereumBlock = require('ethereumjs-block');
const getRevertReason = require('eth-revert-reason');
const ethers = require('ethers');
const ethUtils = require('ethereumjs-util');
const InputDataDecoder = require('ethereum-input-data-decoder');
const BN = require('bn.js');
const { concat, contains } = require('ramda');
const debug = require('debug')('bcnode:rover:eth');
const debugTx = require('debug')('bcnode:rover:ethTx');

const debug721 = require('debug')('bcnode:rover:eth721');

const logging = require('../../logger');
const { errToString } = require('../../helper/error');
const { parseBoolean } = require('../../utils/config');
const { networks, getIdStatus, getAddress, validChains } = require('../../config/networks');
const { Block, MarkedTransaction } = require('@overline/proto/proto/core_pb');
const { SettleTxCheckReq, RoverMessageType, RoverMessage, RoverIdent, RoverSyncStatus } = require('@overline/proto/proto/rover_pb');
const { RpcClient } = require('../../rpc');
const { default: Network } = require('./network');
const roverHelp = require('../helper');
const { createUnifiedBlock } = require('../helper');
const { ERC20, ERC721 } = require('./abi');
const { writeSafely, StandaloneDummyStream } = require('../utils');

const writeBlock = writeSafely('bcnode:rover:eth:controller');
const globalLog = logging.getLogger(__filename);
const BC_NETWORK = process.env.BC_NETWORK || 'main';
const BC_ETH_MARKED_TEST = process.env.BC_ETH_MARKED_TEST === 'true';
const BC_VM = process.env.BC_VM === 'true';
const BC_MINER_BOOT = parseBoolean(process.env.BC_MINER_BOOT); // initialize new super collider
const EMB_CONTRACT_ADDRESS = networks[BC_NETWORK].rovers.eth.embContractId;
const DataDecoder = exports.DataDecoder = new InputDataDecoder(ERC20);
const DataDecoder721 = exports.DataDecoder721 = new InputDataDecoder(ERC721);
const common = new _common2.default({ chain: 'mainnet', hardfork: 'berlin' });
const vm = new _vm2.default({ common });
const ROVER_NAME = 'eth';
const txStatusPass = [];
const txStatusFail = [];

// enabling by default
const TEST_MULTI_TRANSFER = process.env.TEST_MULTI_TRANSFER !== 'false';

const debugEnabled = () => {
  return process.env.DEBUG && process.env.DEBUG.indexOf('bcnode:rover:eth') > -1;
};

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

const getTxStatus = async (mtxId, blockNumber, isEtherTx) => {

  if (!mtxId || mtxId.length < 10) {
    // considere this reverted
    return true;
  }

  const list = getIdStatus();
  const cycle = async (addr, ids) => {

    const timeout = setTimeout(() => {
      throw new Error('tx timeout');
    }, 6100);

    try {

      if (!addr) {
        if (ids.length < 2) {
          throw new Error('unable to determine tx valid state');
        }
      }

      const prov = `${getAddress()}${addr}`;
      const pr = new ethers.providers.JsonRpcProvider(prov);
      let txStatus = '';
      let reverted = false;
      let errored = false;

      if (txStatusPass.indexOf(mtxId) > -1) {
        reverted = false;
      } else if (txStatusFail.indexOf(mtxId) > -1) {
        reverted = true;
      } else {

        // its the first request
        try {
          txStatus = isEtherTx ? '' : await getRevertReason(mtxId, 'mainnet', blockNumber, pr);
          reverted = '' !== txStatus && ' ' !== txStatus && txStatus;
          if (!reverted) {
            txStatusPass.push(mtxId);
          } else {
            txStatusFail.push(mtxId);
          }
        } catch (err) {
          debug(`${mtxId} failed because of ${err}`);
          if (err.message.indexOf('older than') > -1) {
            logger.info(`${mtxId} <- processing`);
            errored = true;
          }
        }

        if (errored) {
          clearTimeout(timeout);

          txStatusPass.push(mtxId);
          return false;
          //throw Error('no an archival node')
        }
      }

      clearTimeout(timeout);
      return reverted;
    } catch (e) {

      debug(e);
      clearTimeout(timeout);

      if (ids.length < 2) {
        throw new Error('unable to determine tx valid state');
      }

      let remaining = ids;

      if (e && e.message !== 'tx timeout') {
        remaining = ids.filter(l => {
          if (l !== addr) {
            return l;
          }
        });
      }

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
      const d = block.toJSON();
      if (!d || !d.header) {
        return reject(new Error(`invalid block structure`));
      }
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

      const blockHash = obj.blockHash;
      const msg = new Block();
      msg.setBlockchain(ROVER_NAME);
      msg.setHash(obj.blockHash);
      msg.setPreviousHash(obj.prevHash);
      msg.setTimestamp(obj.timestamp);
      msg.setHeight(obj.blockNumber);
      msg.setMerkleRoot(obj.root);
      const blockHeight = msg.getHeight();

      debug(`#${block.transactions.length} Transactions for ${obj.blockHash}`);

      let emblemTransactions = [];
      const settlementChecks = [];
      const totalBlockTxs = block && block.transactions ? block.transactions.length : 0;
      const markedNfts = [];
      while (block && block.transactions && block.transactions.length > 0 && obj.blockNumber > 12427601 || BC_ETH_MARKED_TEST && block && block.transactions && block.transactions.length > 0) {
        //for (const tx of block.transactions) {
        const tx = block.transactions.shift();

        try {
          const serializedTx = tx.toJSON(true);
          const txId = ethUtils.bufferToHex(tx.hash(true));
          let addrFrom = ethUtils.bufferToHex(tx.getSenderAddress());
          let decodedInput = DataDecoder.decodeData(serializedTx.data);
          let decodedInput721 = DataDecoder721.decodeData(serializedTx.data);
          let isEmbTx = false;
          let addrTo;
          let amount;
          let tokenType;

          //check for EMB Multitransfer
          if (ethUtils.bufferToHex(tx.to).toLowerCase() === EMB_CONTRACT_ADDRESS && decodedInput.method === 'multiTransfer') {
            let incr = 0;

            const embRev = !oldBlock ? false : await getTxStatus(txId, obj.blockNumber, false);
            if (embRev) break; //if emb reverted, break and continue on to the next transaction

            const input = decodedInput.inputs[0]; //only one arg that contains all bytes27[]
            let length = input.length; //check to see how many transfers there are

            for (let i = 0; i < input.length; i++) {
              let str = input[i].toString('hex');
              let to = str.substring(0, 40);
              if (to && !to.startsWith('0x')) to = `0x${to}`;
              let amount = parseInt(str.substring(40), 16).toString();
              const value = new BN(amount).toBuffer();
              const hash = length == 1 ? txId : `${txId}${i}`; //if many transfers, add an incrementor at the end of the hash

              //create EMB Marked Transaction and add to list
              const mTx = new MarkedTransaction();
              mTx.setId(ROVER_NAME);
              mTx.setToken('emb');
              mTx.setAddrFrom(addrFrom);
              mTx.setAddrTo(to);
              mTx.setValue(new Uint8Array(value));
              mTx.setBlockHeight(blockHeight);
              mTx.setIndex(emblemTransactions.length);
              mTx.setHash(hash);
              emblemTransactions.push(mTx);

              //create a settlement check request and add to list
              const pTx = new SettleTxCheckReq.PossibleTransaction();
              pTx.setAddrFrom(addrFrom);
              pTx.setAddrTo(to);
              pTx.setValue(new Uint8Array(value));
              pTx.setBridgedChain(ROVER_NAME);
              pTx.setTxId(hash);
              pTx.setBlockHeight(blockHeight);
              pTx.setTokenType('emb');
              settlementChecks.push(pTx);
            }
            //now that we checked each decoded input we can break and move on to the next transaction
            break;
          }

          //parsing 721
          if (decodedInput721.method === 'atomicMatch_' || decodedInput721.method === 'atomicMatch' || decodedInput721.method === 'transferFrom' || decodedInput721.method === 'safeTransferFrom' || decodedInput721.method === 'closeSwapIntent' || decodedInput721.method === 'proxyAssert') {
            let [from, to, tokenId] = decodedInput721.inputs;

            for (let _ref of _tokens.ERC721_WATCHED_TOKENS) {
              let { assetName, isEmb, contractAddress } = _ref;

              if (ethUtils.bufferToHex(tx.to).toLowerCase() === contractAddress) {
                if (to && !to.startsWith('0x')) to = `0x${to}`;
                if (from && !from.startsWith('0x')) from = `0x${from}`;

                addrFrom = from;
                addrTo = to;
                amount = tokenId;
                tokenType = assetName;
                isEmbTx = isEmb;
                // no multiple inputs in 721
                const hash = txId;
                const value = new BN(amount).toBuffer();
                const mTx = new MarkedTransaction();
                mTx.setId(ROVER_NAME);
                mTx.setToken(tokenType);
                mTx.setAddrFrom(addrFrom);
                mTx.setAddrTo(to);
                mTx.setValue(new Uint8Array(value));
                mTx.setBlockHeight(blockHeight);
                mTx.setIndex(markedNfts.length);
                mTx.setHash(hash);
                markedNfts.push(mTx);

                debugTx(`ERC721 Token check matched FROM, addrTo: ${addrTo},addrFrom: ${addrFrom}, tokenID: ${amount.toString(10)}, tokenType: ${assetName}, isEmbTx: ${isEmb}, txId: ${txId}`);
              }
            }
          }

          for (let _ref2 of _tokens.ERC20_WATCHED_TOKENS) {
            let { assetName, isEmb, contractAddress } = _ref2;

            contractAddress = contractAddress.toLowerCase();
            // debug(`Token check ${assetName}, method: ${decodedInput.method}, contractAddress: ${ethUtils.bufferToHex(tx.to).toLowerCase()}`)
            if (decodedInput.method === 'transfer' && ethUtils.bufferToHex(tx.to).toLowerCase() === contractAddress) {
              let [to, transferAmount] = decodedInput.inputs;
              if (to && !to.startsWith('0x')) {
                to = `0x${to}`;
              }

              debugTx(`ERC20 Token check matched, addrTo: ${to},addrFrom: ${addrFrom}, amount: ${transferAmount.toString(10)}, tokenType: ${assetName}, isEmbTx: ${isEmb}`);
              addrTo = to;
              amount = transferAmount;
              tokenType = assetName;
              isEmbTx = isEmb;

              break; // do not continue checking - we found the matching contract so it won't be any other one
            }

            if (decodedInput.method === 'transferFrom' && ethUtils.bufferToHex(tx.to).toLowerCase() === contractAddress) {
              let [from, to, transferAmount] = decodedInput.inputs;
              if (to && !to.startsWith('0x')) {
                to = `0x${to}`;
              }
              if (from && !from.startsWith('0x')) {
                from = `0x${from}`;
              }
              addrFrom = from;
              debugTx(`Token check matched FROM, addrTo: ${to},addrFrom: ${addrFrom}, amount: ${transferAmount.toString(10)}, tokenType: ${assetName}, isEmbTx: ${isEmb}, txId: ${txId}`);
              addrTo = to;
              amount = transferAmount;
              tokenType = assetName;
              isEmbTx = isEmb;

              break; // do not continue checking - we found the matching contract so it won't be any other one
            }
          }

          addrTo = addrTo || ethUtils.bufferToHex(tx.to).toLowerCase();
          amount = amount || tx.value;
          const value = new BN(amount, 16).toBuffer();
          const bridgedChain = ROVER_NAME;
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

            const t = mTx.getToken();

            if (obj.timestamp) {}

            const embRev = !oldBlock ? false : await getTxStatus(mTx.getHash(), obj.blockNumber, t === 'eth');
            if (!embRev) {
              emblemTransactions.push(mTx);
            }
            logger.info(`${tokenType} <- ${mTx.getHash()} returned: ${embRev} amount: ${amount} yielded: ${embRev}`);
          }

          if (txStatusFail.length > 4000) {
            txStatusFail.shift();
          }

          if (txStatusPass.length > 4000) {
            txStatusPass.shift();
          }

          // even if EMB, check for settlement
          const pTx = new SettleTxCheckReq.PossibleTransaction();
          pTx.setAddrFrom(addrFrom);
          pTx.setAddrTo(addrTo);
          pTx.setValue(new Uint8Array(value));
          pTx.setBridgedChain(bridgedChain);
          pTx.setTxId(txId);
          pTx.setBlockHeight(blockHeight);
          pTx.setTokenType(tokenType);
          settlementChecks.push(pTx);

          debugTx(`check: ${inspect(addrFrom)}, ${inspect(addrTo)}, ${inspect(value)}, ${inspect(bridgedChain)}, ${inspect(txId)}, ${inspect(blockHeight)}, ${inspect(tokenType)}`);
        } catch (e) {
          // MMM
          debug721(`unable to parse TX ${e}`);
          debugTx(`unable to parse TX ${e}`);
          if (tx && tx.hash) {
            const h = ethUtils.bufferToHex(tx.hash(true));
            logger.warn(`unable to parse tx ${h}, ${e}`);
          }
          // debug(`unable to parse TX's ${ethUtils.bufferToHex(tx.hash(true))}`)
          debug(e);
        }
      }

      let markedTransactions = (await roverHelp.isBeforeSettleHeight(settlementChecks, roverRpc, obj.blockHash, 'eth')) || [];
      // check if any transactions have been queued

      let failedMarkedIds = [];
      let finalMarkedTransactions = [];
      debug(`markedTransactions length: ${markedTransactions.length} for ${obj.blockHash}`);

      // filter out those EMB transactions which were part of the trade and only add those
      // which were on neither side of the trade but we still have to track it
      if (!markedTransactions) {
        markedTransactions = [];
      }

      if (!oldBlock && obj.blockNumber > 12427601 || BC_ETH_MARKED_TEST) {
        for (let mt of markedTransactions) {
          try {
            const mtxId = mt.getHash();
            const token = mt.getToken();
            // if it was an emb tx it was already run above
            const ts = Date.now();
            const reverted = token === 'emb' ? false : await getTxStatus(mtxId, obj.blockNumber, token === 'eth');

            // if not reverted add the marked transaction to final marketd transactions
            logger.info(`${token} <- ${mtxId} returned: ${reverted}, yielded: ${failedMarkedIds.length}`);
            if (!reverted) {
              finalMarkedTransactions.push(mt);
            } else {
              failedMarkedIds.push(mtxId);
            }
          } catch (e) {
            debug(e);
            // MMM
            logger.warn(`establishing id ${mt.getHash()}`);
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

      const queuedMarkedTransactions = (await roverHelp.getQueuedMarkedTxs(markedTransactions, roverRpc, blockHash, 'eth')) || [];

      // 14399993
      // START BLOCK FOR NFT MARKS

      // active marked txs are counted, the remaining are balance updates
      const markedTxCount = markedTransactions.length;

      if (blockHeight >= 14399993 && markedNfts.length > 0) {
        markedTransactions = concat(markedTransactions, markedNfts);
      }

      logger.info(`${totalBlockTxs} / ${finalMarkedTransactions.length} / ${emblemTransactions.length} / queued mtx ${queuedMarkedTransactions.length} / marked nft ${markedNfts.length} <- ${obj.blockNumber} - ${obj.blockHash}`);

      msg.setBlockchain('eth');
      msg.setHash(obj.blockHash);
      msg.setPreviousHash(obj.prevHash);
      msg.setTimestamp(obj.timestamp);
      msg.setHeight(obj.blockNumber);
      msg.setMerkleRoot(obj.root);
      msg.setMarkedTxsList(markedTransactions);
      msg.setMarkedTxCount(markedTxCount); // not if there are nft updates
      return resolve(msg);
    } catch (e) {
      /// MMM
      return reject(e);
    }
  });
}

/**
 * ETH Controller
 */
class Controller {

  constructor(isStandalone) {
    this._outbox = [];
    this._dpt = false;
    this._lastBlockCache = '';
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

    const hash = block.header.hash().toString('hex');
    const height = new BN(block.header.number).toNumber();
    debug(`prepare createUnifiedBlock <- ${height} txs: ${block.transactions.length}`);

    if (this._lastBlockCache === hash) {
      this._network.emit('compressBlock', block);
      return;
    } else {
      this._lastBlockCache = block.header.hash().toString('hex');
    }
    const unifiedBlock = await createUnifiedBlock(this._isStandalone, block, this._rpc.rover, _createUnifiedBlock, isBlockFromInitialSync);
    if (!this._isStandalone) {
      this._logger.info(`rover transporting block : "${unifiedBlock.getHeight()}" : ${unifiedBlock.getHash().slice(0, 21)}`);
      writeBlock(this._blockStream, unifiedBlock);
    } else {
      if (debugEnabled()) {
        debug(`collected new ETH block: ${unifiedBlock.toObject()}`);
      }
    }
    return Promise.resolve(true);
  }

  start(config) {
    var network = new Network(config);
    network.on('newBlock', ({ block, isBlockFromInitialSync }) => {
      try {
        this.transmitNewBlock(block, isBlockFromInitialSync);
      } catch (e) {
        this._logger.error(`error creating block: ${e.message}`);
        network.emit('block:error', block);
      }
    });
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

    setInterval(() => {
      const uniq = [];
      const outbox = [];
      const originalCount = this._outbox.length;

      if (this._outbox.length > 0) {

        this._outbox = this._outbox.reduce((empty, ub) => {
          if (uniq.indexOf(ub.getHash()) < 0) {
            uniq.push(ub.getHash());
            outbox.push(ub);
          }
          return empty;
        }, []);

        while (outbox.length > 0) {
          const ub = outbox.shift();
        }
      }
    }, 250);

    process.on('disconnect', () => {
      this._logger.info('parent sent disconnect event');
      process.exit();
    });

    process.on('uncaughtException', e => {
      // console.trace(e)
      this._logger.error(`uncaught exception: ${errToString(e)}`);
    });

    const rpcStream = this._rpc.rover.join(new RoverIdent(['eth']));
    rpcStream.on('error', err => {
      this._logger.error(err);
    });
    rpcStream.on('data', message => {
      if (debugEnabled()) {
        debug(`rpcStream: Received ${JSON.stringify(message.toObject(), null, 2)}`);
      }
      switch (message.getType()) {// Also could be message.getPayloadCase()
        case RoverMessageType.REQUESTRESYNC:
          this.network.initialResync = true;
          this.network.resyncData = message.getResync();
          break;

        case RoverMessageType.FETCHBLOCK:
          const payload = message.getFetchBlock();
          this.network.requestBlockRange([payload.getToBlock(), payload.getFromBlock()]);
          break;

        case RoverMessageType.LATESTBLOCK:
          this._logger.info(`latest block received from manager`);
          const lbm = message.getLatestBlock();
          this.network.updateLatestBlock(lbm.getBlock());
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