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
const grpc = require('@grpc/grpc-js');
const grpcOld = require('grpc');

const { BcClient } = require('../protos/bc_grpc_pb');
const { MinerClient } = require('../protos/miner_grpc_pb');
const { RoverClient } = require('../protos/rover_grpc_pb');

const { config } = require('../config');

const GRPC_HOST = process.env.BC_GRPC_HOST || config.grpc.host;
const GRPC_PORT = process.env.BC_GRPC_PORT || config.grpc.port;
const GRPC_URL = `${GRPC_HOST}:${GRPC_PORT}`;
const GRPC_MINER_URL = `${process.env.BC_GRPC_MINER_ADDRESS || 'gpuminer:50052'}`;

class RpcClient {
  // eslint-disable-line no-undef

  constructor() {
    this._services = {
      bc: new BcClient(GRPC_URL, grpcOld.credentials.createInsecure()),
      miner: new MinerClient(GRPC_MINER_URL, grpcOld.credentials.createInsecure()),
      rover: new RoverClient(GRPC_URL, grpcOld.credentials.createInsecure())
    };
  }

  service(name) {
    return this._services[name];
  }

  get bc() {
    return this._services.bc;
  }

  get miner() {
    return this._services.miner;
  }

  get rover() {
    return this._services.rover;
  }
}

exports.RpcClient = RpcClient;
exports.default = RpcClient;