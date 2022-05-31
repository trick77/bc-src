'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});


const QueueEventEmitter = require('queue-event-emitter'); /**
                                                           * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                           *
                                                           * This source code is licensed under the MIT license found in the
                                                           * LICENSE file in the root directory of this source tree.
                                                           *
                                                           * 
                                                           */

const { EventEmitter } = require('events');

const grpc = require('@grpc/grpc-js');
const { config } = require('../config');

const logging = require('../logger');

const { BcService } = require('@overline/proto/proto/bc_grpc_pb');
const { BcServiceImpl } = require('./service');

const { RoverService } = require('@overline/proto/proto/rover_grpc_pb');
const { RoverServiceImpl } = require('./service');

const { PubSub } = require('../engine/pubsub');

const GRPC_HOST = process.env.BC_GRPC_HOST || config.grpc.host;
const GRPC_PORT = process.env.BC_GRPC_PORT || config.grpc.port;
const GRPC_URL = `${GRPC_HOST}:${GRPC_PORT}`;

class RpcServer {
  // eslint-disable-line no-undef

  // eslint-disable-line no-undef
  constructor(engine) {
    this._logger = logging.getLogger(__filename);
    this._engine = engine;

    this._rpcServer = new grpc.Server();
    // Start BcService

    this._rpcServer.bindAsync(GRPC_URL, grpc.ServerCredentials.createInsecure(), err => {
      this._logger.info(`Starting gRPC OlService - ${GRPC_URL}`);
      this._rpcServer.addService(BcService, new BcServiceImpl(this));

      // Start RoverService
      this._logger.info(`Starting gRPC RoverService - ${GRPC_URL}`);
      this._rpcServer.addService(RoverService, new RoverServiceImpl(this, this.emitter, this.roverEmitter));
      this._rpcServer.start();
    });
  } // eslint-disable-line no-undef


  get emitter() {
    return this._engine._emitter;
  }

  get roverEmitter() {
    return this._engine._roverEmitter;
  }

  get logger() {
    return this._logger;
  }

  get pubsub() {
    return this._engine.pubsub;
  }

  get server() {
    return this._rpcServer;
  }

  get engine() {
    return this._engine;
  }
}

exports.RpcServer = RpcServer;
exports.default = RpcServer;