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

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const { inspect } = require('util'); /**
                                      * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
                                      *
                                      * This source code is licensed under the MIT license found in the
                                      * LICENSE file in the root directory of this source tree.
                                      *
                                      * 
                                      */

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
const { networks, getIdStatus, getAddress } = require('../../config/networks');
const { Block, MarkedTransaction } = require('../../protos/core_pb');
const { SettleTxCheckReq, RoverMessageType, RoverMessage, RoverIdent, RoverSyncStatus } = require('../../protos/rover_pb');
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

const ERC20_WATCHED_TOKENS = [{ assetName: 'emb', isEmb: true, contractAddress: EMB_CONTRACT_ADDRESS }, { assetName: 'dai', isEmb: false, contractAddress: '0x6b175474e89094c44da98b954eedeac495271d0f' }, { assetName: 'usdt', isEmb: false, contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7' }, { assetName: 'xaut', isEmb: false, contractAddress: '0x4922a015c4407f87432b179bb209e125432e4a2a' }, { assetName: 'mph', isEmb: false, contractAddress: '0x8888801af4d980682e47f1a9036e589479e835c5' }, { assetName: 'keep', isEmb: false, contractAddress: '0x85eee30c52b0b379b046fb0f85f4f3dc3009afec' }, { assetName: 'sand', isEmb: false, contractAddress: '0x3845badade8e6dff049820680d1f14bd3903a5d0' }, { assetName: 'ramp', isEmb: false, contractAddress: '0x33d0568941c0c64ff7e0fb4fba0b11bd37deed9f' }, { assetName: 'stake', isEmb: false, contractAddress: '0x0ae055097c6d159879521c384f1d2123d1f195e6' }, { assetName: 'yfdai', isEmb: false, contractAddress: '0xf4cd3d3fda8d7fd6c5a500203e38640a70bf9577' }, { assetName: 'cvp', isEmb: false, contractAddress: '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1' }, { assetName: 'omg', isEmb: false, contractAddress: '0xd26114cd6ee289accf82350c8d8487fedb8a0c07' }, { assetName: 'bao', isEmb: false, contractAddress: '0x374cb8c27130e2c9e04f44303f3c8351b9de61c1' }, { assetName: 'comp', isEmb: false, contractAddress: '0xc00e94cb662c3520282e6f5717214004a7f26888' }, { assetName: 'apy', isEmb: false, contractAddress: '0x95a4492f028aa1fd432ea71146b433e7b4446611' }, { assetName: 'onx', isEmb: false, contractAddress: '0xe0ad1806fd3e7edf6ff52fdb822432e847411033' }, { assetName: 'ren', isEmb: false, contractAddress: '0x408e41876cccdc0f92210600ef50372656052a38' }, { assetName: 'fink', isEmb: false, contractAddress: '0xb5fe099475d3030dde498c3bb6f3854f762a48ad' }, { assetName: 'ankreth', isEmb: false, contractAddress: '0xe95a203b1a91a908f9b9ce46459d101078c2c3cb' }, { assetName: 'perp', isEmb: false, contractAddress: '0xbc396689893d065f41bc2c6ecbee5e0085233447' }, { assetName: 'orn', isEmb: false, contractAddress: '0x0258f474786ddfd37abce6df6bbb1dd5dfc4434a' }, { assetName: 'grt', isEmb: false, contractAddress: '0xc944e90c64b2c07662a292be6244bdf05cda44a7' }, { assetName: 'combo', isEmb: false, contractAddress: '0xffffffff2ba8f66d4e51811c5190992176930278' }, { assetName: 'farm', isEmb: false, contractAddress: '0xa0246c9032bc3a600820415ae600c6388619a14d' }, { assetName: 'pickle', isEmb: false, contractAddress: '0x429881672b9ae42b8eba0e26cd9c73711b891ca5' }, { assetName: 'pbtc35a', isEmb: false, contractAddress: '0xa8b12cc90abf65191532a12bb5394a714a46d358' }, { assetName: 'rook', isEmb: false, contractAddress: '0xfa5047c9c78b8877af97bdcb85db743fd7313d4a' }, { assetName: 'yfi', isEmb: false, contractAddress: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e' }, { assetName: 'snx', isEmb: false, contractAddress: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f' }, { assetName: 'tru', isEmb: false, contractAddress: '0x4c19596f5aaff459fa38b0f7ed92f11ae6543784' }, { assetName: 'xor', isEmb: false, contractAddress: '0x40fd72257597aa14c7231a7b1aaa29fce868f677' }, { assetName: 'crv', isEmb: false, contractAddress: '0xd533a949740bb3306d119cc777fa900ba034cd52' }, { assetName: 'cc10', isEmb: false, contractAddress: '0x17ac188e09a7890a1844e5e65471fe8b0ccfadf3' }, { assetName: 'cel', isEmb: false, contractAddress: '0xaaaebe6fe48e54f431b0c390cfaf0b017d09d42d' }, { assetName: 'ddim', isEmb: false, contractAddress: '0xfbeea1c75e4c4465cb2fccc9c6d6afe984558e20' }, { assetName: 'lrc', isEmb: false, contractAddress: '0xbbbbca6a901c926f240b89eacb641d8aec7aeafd' }, { assetName: 'mir', isEmb: false, contractAddress: '0x09a3ecafa817268f77be1283176b946c4ff2e608' }, { assetName: 'tru', isEmb: false, contractAddress: '0x0000000000085d4780b73119b644ae5ecd22b376' }, { assetName: 'pols', isEmb: false, contractAddress: '0x83e6f1e41cdd28eaceb20cb649155049fac3d5aa' }, { assetName: 'exrd', isEmb: false, contractAddress: '0x6468e79a80c0eab0f9a2b574c8d5bc374af59414' }, { assetName: 'duck', isEmb: false, contractAddress: '0xc0ba369c8db6eb3924965e5c4fd0b4c1b91e305f' }, { assetName: 'fxs', isEmb: false, contractAddress: '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0' }, { assetName: 'sdt', isEmb: false, contractAddress: '0x73968b9a57c6e53d41345fd57a6e6ae27d6cdb2f' }, { assetName: 'alpha', isEmb: false, contractAddress: '0xa1faa113cbe53436df28ff0aee54275c13b40975' }, { assetName: 'renbtc', isEmb: false, contractAddress: '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d' }, { assetName: 'lon', isEmb: false, contractAddress: '0x0000000000095413afc295d19edeb1ad7b71c952' }, { assetName: 'ampl', isEmb: false, contractAddress: '0xd46ba6d942050d489dbd938a2c909a5d5039a161' }, { assetName: 'bac', isEmb: false, contractAddress: '0x3449fc1cd036255ba1eb19d65ff4ba2b8903a69a' }, { assetName: 'mkr', isEmb: false, contractAddress: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2' }, { assetName: 'aave', isEmb: false, contractAddress: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9' }, { assetName: 'bond', isEmb: false, contractAddress: '0x0391d2021f89dc339f60fff84546ea23e337750f' }, { assetName: 'hez', isEmb: false, contractAddress: '0xeef9f339514298c6a857efcfc1a762af84438dee' }, { assetName: 'dpi', isEmb: false, contractAddress: '0x1494ca1f11d487c2bbe4543e90080aeba4ba3c2b' }, { assetName: 'core', isEmb: false, contractAddress: '0x62359ed7505efc61ff1d56fef82158ccaffa23d7' }, { assetName: 'link', isEmb: false, contractAddress: '0x514910771af9ca656af840dff83e8264ecf986ca' }, { assetName: 'ust', isEmb: false, contractAddress: '0xa47c8bf37f92abed4a126bda807a7b7498661acd' }, { assetName: 'frax', isEmb: false, contractAddress: '0x853d955acef822db058eb8505911ed77f175b99e' }, { assetName: 'wise', isEmb: false, contractAddress: '0x66a0f676479cee1d7373f3dc2e2952778bff5bd6' }, { assetName: 'uni', isEmb: false, contractAddress: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984' }, { assetName: 'wbtc', isEmb: false, contractAddress: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' }];

const validChains = ['btc', 'eth', 'lsk', 'wav', 'neo', 'dai', 'emb', 'usdt', 'xaut', 'wbtc', 'uni', 'wise', 'frax', 'ust', 'link', 'core', 'dpi', 'hez', 'bond', 'mkr', 'ampl', 'bac', 'lon', 'alpha', 'sdt', 'duck', 'pols', 'exrd', 'tusd', 'lrc', 'ddim', 'cel', 'cc10', 'crv', 'tru', 'xor', 'yfi', 'snx', 'rook', 'pbtc35a', 'pickle', 'farm', 'grt', 'combo', 'orn', 'perp', 'ankreth', 'fnk', 'ren', 'onx', 'apy', 'comp', 'bao', 'omg', 'cvp', 'yfdai', 'stake', 'ramp', 'sand', 'keep', 'mph', 'renbtc'];

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

      debug(`#${block.transactions.length} Transactions for ${obj.blockHash}`);

      let emblemTransactions = [];
      const settlementChecks = [];
      const totalBlockTxs = block && block.transactions ? block.transactions.length : 0;
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

          //parsing 721
          // if (decodedInput721.method === 'transferFrom' || decodedInput721.method === 'safeTransferFrom'){
          //   let [from, to, tokenId] = decodedInput721.inputs
          //   if (to && !to.startsWith('0x')) to = `0x${to}`
          //   if (from && !from.startsWith('0x')) from = `0x${from}`
          //   tokenType = ethUtils.bufferToHex(tx.to).toLowerCase()
          //   debug721(`Token 721 check matched, addrTo: ${to}, tokenID: ${tokenId}, from: ${from}, contract: ${tokenType}, hash: ${txId}`)
          // }

          for (let _ref of ERC20_WATCHED_TOKENS) {
            let { assetName, isEmb, contractAddress } = _ref;

            // debug(`Token check ${assetName}, method: ${decodedInput.method}, contractAddress: ${ethUtils.bufferToHex(tx.to).toLowerCase()}`)
            if (decodedInput.method === 'transfer' && ethUtils.bufferToHex(tx.to).toLowerCase() === contractAddress) {
              let [to, transferAmount] = decodedInput.inputs;
              if (to && !to.startsWith('0x')) {
                to = `0x${to}`;
              }

              debug(`Token check matched, addrTo: ${to},addrFrom: ${addrFrom}, amount: ${transferAmount.toString(10)}, tokenType: ${assetName}, isEmbTx: ${isEmb}`);
              addrTo = to;
              amount = transferAmount;
              tokenType = assetName;
              isEmbTx = isEmb;

              break; // do not continue checking - we found the matching contract so it won't be any other one
            }

            if (TEST_MULTI_TRANSFER) {
              if (decodedInput.method === 'multiTransfer' && ethUtils.bufferToHex(tx.to).toLowerCase() === contractAddress) {
                debug({ decodedInput });
                for (let input of decodedInput.inputs) {
                  let str = input[0].toString('hex');
                  let to = str.substring(0, 40);
                  let amount = parseInt(str.substring(40), 16).toString();
                  debug({ input });
                  debug({ to, amount });
                  debug({ bn: new BN(str.substring(40), 16) });
                  debug({ bnString: new BN(str.substring(40), 16).toString() });
                  debug(new Uint8Array(new BN(str.substring(40), 16)));
                  debug(input[0].toString('hex'));
                }
                debug('multi transfer inputs', decodedInput.inputs);
              }
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
            this._logger.warn(`unable to parse tx ${h}`);
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

      logger.info(`${totalBlockTxs} / ${finalMarkedTransactions.length} / ${emblemTransactions.length} / queued mtx ${queuedMarkedTransactions.length} <- ${obj.blockNumber} - ${obj.blockHash}`);

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