'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});


const debug = require('debug')('bcnode:rpc:server:rover'); /**
                                                            * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                            *
                                                            * This source code is licensed under the MIT license found in the
                                                            * LICENSE file in the root directory of this source tree.
                                                            *
                                                            * 
                                                            */

const BC_MINER_MUTEX = process.env.BC_MINER_MUTEX === 'true';
const BC_SUPER_COLLIDER = process.env.BC_SUPER_COLLIDER ? process.env.BC_SUPER_COLLIDER.toLowerCase() : 'bc';

const LRUCache = require('lru-cache');
const RpcServer = require('../server').default;
const UnsettledTxManagerAlt = require('../../bc/unsettledTxManagerAlt');
const QueueEventEmitter = require('queue-event-emitter');

const { collectBlock } = require('./rover/index');
const { QueuedMarkedTxsResponse, SettleTxCheckResponse } = require('@overline/proto/proto/rover_pb');
const { Null, Block } = require('@overline/proto/proto/core_pb');
const { getLogger } = require('../../logger');

const logger = getLogger(__filename);

class CollectorServiceImpl {
  // eslint-disable-line no-undef
  constructor(server, emitter, roverEmitter) {
    this._server = server;
    this._emitter = emitter;

    this._knownRequests = new LRUCache({
      max: 200
    });

    this._roverEmitter = roverEmitter;
    let persistence = server.engine.persistence;
    this._persistence = persistence;
    this._unsettledTxManagerAlt = new UnsettledTxManagerAlt(persistence, server.engine.minerKey);
  }

  get server() {
    return this._server;
  }

  /**
   * Implements the collectBlock RPC method.
   */
  collectBlock(call, callback) {
    debug(`collectBlock() call: %o`, call);
    call.on('data', message => {
      //debug(`STREAM Got block %o`, message.toObject())
      collectBlock(this._getContext(), message);
      return;
    });

    call.on('error', function (err) {
      logger.error(`STREAM error while collecting block %o`, err.stack);
    });

    call.on('status', function (status) {
      debug(`STREAM STATUS %o`, status);
    });
  }

  isBeforeSettleHeight(call, callback) {
    const req = call.request;
    let blockHash = req.getBlockHash();
    let blockchain = req.getBridgedChain ? "" : req.getBridgedChain();
    const possibleTransactions = req.getPossibleTransactionsList();
    logger.debug(`isBeforeSettleHeight-grpc possibleTransactions.length: ${possibleTransactions.length}`);
    const key = `${blockHash}${possibleTransactions.length}`;

    if (this._knownRequests.has(key)) {
      const cached = this._knownRequests.get(key);
      this._knownRequests.del(key);
      return callback(null, cached);
    }

    const grpcResult = new SettleTxCheckResponse();
    let result = this._unsettledTxManagerAlt.onNewRoveredBlock(possibleTransactions, blockHash, blockchain).then(result => {
      grpcResult.setMarkedTransactionsList(result);
      this._knownRequests.set(key, grpcResult);
      callback(null, grpcResult);
    }).catch(err => {
      console.trace(err);
      logger.error(`error: ${err}`);
      callback(err);
    });
  }

  getQueuedMarkedTxs(call, callback) {
    const req = call.request;
    let blockchain = req.getBlockchain();
    let blockHash = req.getBlockHash();
    const markedTxs = req.getMarkedTransactionsList();

    logger.debug(`getQueuedMarkedTxs-grpc markedTxs.length: ${markedTxs.length}, blockchain: ${blockchain} ${blockHash}`);

    const grpcResult = new QueuedMarkedTxsResponse();
    grpcResult.setBlockHash(blockHash);
    if (markedTxs.length < 1) {
      grpcResult.setMarkedTransactionsList([]);
      return callback(null, grpcResult);
    }

    let result = this._unsettledTxManagerAlt.getQueuedMarkedTxs(markedTxs, blockHash, blockchain).then(result => {
      grpcResult.setMarkedTransactionsList(result);
      callback(null, grpcResult);
    }).catch(err => {
      console.trace(err);
      logger.error(`error: ${err}`);
      callback(err);
    });
  }

  join(call, callback) {
    this.server.engine.rovers.roverRpcJoined(call);
  }

  reportSyncStatus(call, callback) {
    this.server.engine.rovers.setRoverSyncStatus(call, function () {
      callback(null, new Null());
    });
  }

  reportBlockRange(call, callback) {
    this.server.engine.rovers.setRoverBlockRange(call, function () {
      callback(null, new Null());
    });
  }

  _getContext() {
    return {
      server: this._server,
      emitter: this._emitter,
      roverEmitter: this._roverEmitter
    };
  }
}
exports.default = CollectorServiceImpl;