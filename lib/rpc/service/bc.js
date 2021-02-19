'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const { getLogger } = require('../../logger');

const { blake2bl } = require('../../utils/crypto');
const { getVersion } = require('../../helper/version');

const {
  GetBlake2blRequest, GetBlake2blResponse,
  RpcTransactionResponse, TakerOrder,
  GetUnlockTakerTxParamsResponse,
  RpcTransactionResponseStatus,
  GetOpenOrdersResponse,
  GetMatchedOrdersResponse,
  GetHistoricalOrdersResponse,
  GetUnlockTakerTxParamsRequest,
  VanityConvertResponse, VanityConvertRequest,
  GetHistoryRequest,
  GetBalanceRequest, CurrentWork, SettingsResponse
} = require('../../protos/bc_pb');

const Vanity = require('../../bc/vanity');

const {
  getLatestUTXOBlock,
  getSyncStatus,
  getTxClaimedBy,
  getLatestBlock,
  getLatestRoveredBlocks,
  getBlockHeight,
  getBlocksHeight,
  getBlockHash,
  getRoveredBlockHeight,
  getRoveredBlockHash,
  getBlocks,
  getRoveredBlocks,
  getTx,
  getMarkedTx,
  help,
  stats,
  getSpendableCollateral,
  getBalance,
  getWallet,
  getBlockByTx,
  getRoveredBlockForMarkedTx,
  getRawMempool,
  getOutpointStatus,
  getTradeStatus,
  getTransfers,
  getUTXOLength,
  getSTXOLength,
  getSpendableOutpoints,
  getUnmatchedOrders,
  getNrgSupply,
  newTx,
  newFeed,
  getMarkedTxsForMatchedOrder,
  sendTx
} = require('./bc/index');

class BcServiceImpl {
  // eslint-disable-line no-undef

  constructor(server) {
    this._server = server;
    this._logger = getLogger(__filename);
  } // eslint-disable-line no-undef


  get server() {
    return this._server;
  }

  getMarkedTxsForMatchedOrder(call, callback) {
    getMarkedTxsForMatchedOrder(this._getContext(), call, callback);
  }

  getNrgSupply(call, callback) {
    getNrgSupply(this._getContext(), call, callback);
  }
  getSyncStatus(call, callback) {
    getSyncStatus(this._getContext(), call, callback);
  }
  getUTXOLength(call, callback) {
    getUTXOLength(this._getContext(), call, callback);
  }

  getSTXOLength(call, callback) {
    getSTXOLength(this._getContext(), call, callback);
  }

  getTxClaimedBy(call, callback) {
    getTxClaimedBy(this._getContext(), call, callback);
  }

  getSpendableOutpoints(call, callback) {
    getSpendableOutpoints(this._getContext(), call, callback);
  }
  /**
   \* Get all unmatched orders
   */
  getUnmatchedOrders(call, callback) {
    getUnmatchedOrders(this._getContext(), call, callback);
  }

  /**
   \* Check if Outpoint is unspent
   */
  getOutpointStatus(call, callback) {
    getOutpointStatus(this._getContext(), call, callback);
  }

  /**
   \* Get Settle Status of Trade
   */
  getTradeStatus(call, callback) {
    getTradeStatus(this._getContext(), call, callback);
  }

  /**
   \* Get Raw Mempool
   */
  getRawMempool(call, callback) {
    getRawMempool(this._getContext(), call, callback);
  }

  /**
   \* Get Latest UTXO BC Block
   */
  getLatestUTXOBlock(call, callback) {
    getLatestUTXOBlock(this._getContext(), call, callback);
  }

  /**
   \* Get  Latest BC Block
   */
  getLatestBlock(call, callback) {
    getLatestBlock(this._getContext(), call, callback);
  }

  /**
   \* Get Latest Rovered Blocks
   */
  getLatestRoveredBlocks(call, callback) {
    getLatestRoveredBlocks(this._getContext(), call, callback);
  }

  /**
   \* Get BC Block By Height
   */
  getBlockHeight(call, callback) {
    getBlockHeight(this._getContext(), call, callback);
  }

  /**
   \* Get BC Blocks By Height
   */
  getBlocksHeight(call, callback) {
    getBlocksHeight(this._getContext(), call, callback);
  }

  /**
   \* Get BC Block By Hash
   */
  getBlockHash(call, callback) {
    getBlockHash(this._getContext(), call, callback);
  }

  /**
   \* Get Rovered Block By Height
   */
  getRoveredBlockHeight(call, callback) {
    getRoveredBlockHeight(this._getContext(), call, callback);
  }

  /**
   \* Get Rovered Block By Hash
   */
  getRoveredBlockHash(call, callback) {
    getRoveredBlockHash(this._getContext(), call, callback);
  }

  /**
   \* Get BC Blocks
   */
  getBlocks(call, callback) {
    getBlocks(this._getContext(), call, callback);
  }

  /**
   \* Get Rovered Blocks
   */
  getRoveredBlocks(call, callback) {
    getRoveredBlocks(this._getContext(), call, callback);
  }

  /**
   \* Get Tx
   */
  getTx(call, callback) {
    getTx(this._getContext(), call, callback);
  }

  /**
   \* Get Marked Tx
   */
  getMarkedTx(call, callback) {
    getMarkedTx(this._getContext(), call, callback);
  }

  /**
   \* Get Block For Tx
   */
  getBlockByTx(call, callback) {
    getBlockByTx(this._getContext(), call, callback);
  }

  /**
   \* Get Rovered Block for Marked Tx
   */
  getRoveredBlockForMarkedTx(call, callback) {
    getRoveredBlockForMarkedTx(this._getContext(), call, callback);
  }

  /**
   * Help
   */
  help(call, callback) {
    help(this._getContext(), call, callback);
  }

  /**
   * Statistics
   */
  stats(call, callback) {
    stats(this._getContext(), call, callback);
  }

  /**
   * Send raw TX
   */
  sendTx(call, callback) {
    sendTx(this._getContext(), call, callback);
  }

  /**
   * Create and Send Transfer Tx
   */
  newTx(call, callback) {
    newTx(this._getContext(), call, callback);
  }

  /**
   * Create Feed Tx
   */
  newFeed(call, callback) {
    newFeed(this._getContext(), call, callback);
  }

  /**
   \* Get transfer history of address
   */
  getTransfers(call, callback) {
    getTransfers(this._getContext(), call, callback);
  }

  /**
   \* Get  balance of NRG for address
   */
  getBalance(call, callback) {
    getBalance(this._getContext(), call, callback);
  }

  /**
   \* Get  balance of NRG for address
   */
  getWallet(call, callback) {
    getWallet(this._getContext(), call, callback);
  }

  getSpendableCollateral(call, callback) {
    getSpendableCollateral(this._getContext(), call, callback);
  }

  getBlake2bl(call, callback) {
    const req = call.request;
    const times = req.getTimes();
    let res = req.getToBeHashed();

    for (let i = 0; i < times; i++) {
      res = blake2bl(res);
    }
    callback(null, new GetBlake2blResponse([res]));
  }

  getUnlockTakerTxParams(call, callback) {
    const unlockScriptsReq = call.request;
    const txHash = unlockScriptsReq.getTxHash();
    const txOutputIndex = unlockScriptsReq.getTxOutputIndex();

    this._server.engine.persistence.getUnlockTakerTxParams(txHash, txOutputIndex).then(res => {
      const response = new GetUnlockTakerTxParamsResponse();
      response.setUnlockScriptsList(res.scripts);
      if (res.value) {
        response.setValueInTx(res.value);
      }
      callback(null, response);
    }).catch(err => {
      callback(err);
    });
  }

  getOrderbookUpdate(call, callback) {
    this._server.engine._dex.getOrderbookUpdate().then(update => {
      callback(null, update);
    }).catch(err => {
      callback(err);
    });
  }

  getOpenOrders(call, callback) {
    const req = call.request;
    const bCAddress = req.getAddress().toLowerCase();
    const from = req.getFrom();
    const to = req.getTo();

    this._server.engine._dex.getOpenOrders(bCAddress, from, to).then(orders => {
      const grpcRes = new GetOpenOrdersResponse();
      grpcRes.setOrdersList(orders);
      callback(null, grpcRes);
    }).catch(err => {
      callback(err);
    });
  }

  getMatchedOrders(call, callback) {
    const req = call.request;
    const bCAddress = req.getAddress().toLowerCase();
    const from = req.getFrom();
    const to = req.getTo();
    this._server.engine._dex.getMatchedOrders(bCAddress, from, to).then(orders => {
      const grpcRes = new GetMatchedOrdersResponse();
      grpcRes.setOrdersList(orders);
      callback(null, grpcRes);
    }).catch(err => {
      this._logger.error(err);
      callback(err.toString());
    });
  }

  getHistoricalOrders(call, callback) {
    const req = call.request;
    let from = req.getFrom();
    let max = req.getMax();
    this._server.engine._dex.getHistoricalOrders(from, max).then(({ orders, nextBlock }) => {
      const grpcRes = new GetHistoricalOrdersResponse();
      grpcRes.setOrdersList(orders);
      grpcRes.setNextBlock(nextBlock);
      callback(null, grpcRes);
    }).catch(err => {
      this._logger.error(err);
      callback(err.toString());
    });
  }

  getBcAddressViaVanity(call, callback) {
    const vanityConvertReq = call.request;
    Vanity.convertVanity(vanityConvertReq.getVanity(), (err, bCAddress) => {
      const res = new VanityConvertResponse();
      if (err) {
        res.setError(err.message);
      } else {
        res.setBcAddress(bCAddress);
      }
      callback(null, res);
    });
  }

  getCurrentWork(call, callback) {
    const res = new CurrentWork();
    const currentWork = this._server.engine.miningOfficer._currentWork ? this._server.engine.miningOfficer._currentWork : '';
    res.setWork(currentWork);
    callback(null, res);
  }

  getSettings(call, callback) {
    const res = new SettingsResponse();
    const tunnelAddress = this._server.engine.server._ngrokTunnelAddress;
    const versionInfo = getVersion();
    const buildVersion = `${versionInfo.npm};${versionInfo.git.short}`;
    res.setNgrokTunnel(tunnelAddress);
    res.setBuildVersion(buildVersion);
    callback(null, res);
  }

  _getContext() {
    return {
      logger: this._logger,
      server: this._server
    };
  }
}
exports.default = BcServiceImpl;