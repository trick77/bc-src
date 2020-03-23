'use strict';

/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const grpc = require('grpc');
const debug = require('debug')('mockGrpc');
const { config } = require('../config');

const { Null, Block } = require('../protos/core_pb');
const { RoverMessage, RoverMessageType, SettleTxCheckResponse } = require('../protos/rover_pb');
const { RoverService } = require('../protos/rover_grpc_pb');

const GRPC_HOST = process.env.BC_GRPC_HOST || config.grpc.host;
const GRPC_PORT = process.env.BC_GRPC_PORT || config.grpc.port;
const GRPC_URL = `${GRPC_HOST}:${GRPC_PORT}`;
let roverStream;

class MockRoverServiceImpl {
  collectBlock(call, callback) {
    debug(`collectBlock() stream open`);
    call.on('data', message => {
      debug(`STREAM Got block %o`, message.getHeight());
    });
    call.on('error', function (err) {
      debug(`STREAM error while collecting block %o`, err.stack);
    });

    call.on('status', function (status) {
      debug(`STREAM STATUS %o`, status);
    });
    // callback(null, Null())
  }

  isBeforeSettleHeight(call, callback) {
    const req = call.request;
    const possibleTransactions = req.getPossibleTransactionsList();
    debug(`isBeforeSettleHeight-grpc possibleTransactions.length: ${possibleTransactions.length}`);
    const grpcResult = new SettleTxCheckResponse();
    grpcResult.setMarkedTransactionsList([]);
    callback(null, grpcResult);
  }

  join(call, callback) {
    const roverName = call.request.getRoverName();
    debug(`Rover ${roverName} joined using gRPC`);
    roverStream = call;
  }

  reportSyncStatus(call, callback) {
    const roverName = call.request.getRoverName();
    const isSynced = call.request.getStatus();
    debug(`Rover ${roverName} reporting sync status: ${isSynced}`);
    callback(null, new Null());
  }

  reportBlockRange(call, callback) {
    const roverName = call.request.getRoverName();
    debug(`block range recieved from ${roverName} rover`);
    callback(null, new Null());
  }
}
const rpcServer = new grpc.Server();
rpcServer.bind(GRPC_URL, grpc.ServerCredentials.createInsecure());
rpcServer.addService(RoverService, new MockRoverServiceImpl());

setTimeout(() => {
  const msg = new RoverMessage();
  const resyncPayload = new RoverMessage.Resync();
  msg.setType(RoverMessageType.REQUESTRESYNC);
  // resyncPayload.setLatestBlock(payload.latestBlock)
  const i = new RoverMessage.Resync.Interval();
  const fromBlock = new Block();
  fromBlock.setHeight(9986800);
  i.setFromBlock(fromBlock);
  const toBlock = new Block();
  toBlock.setHeight(9989020);
  i.setToBlock(toBlock);
  const intervalsFetchBlocks = [i];
  resyncPayload.setIntervalsList(intervalsFetchBlocks);
  msg.setResync(resyncPayload);
  roverStream.write(msg);
}, 10000);
rpcServer.start();
debug('Grpc server bound %o', GRPC_URL);