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

const { BcClient } = require('@overline/proto/proto/bc_grpc_pb');
const { MinerClient } = require('@overline/proto/proto/miner_grpc_pb');
const { RoverClient } = require('@overline/proto/proto/rover_grpc_pb');

const { config } = require('../config');

const GRPC_HOST = process.env.BC_GRPC_HOST || config.grpc.host;
const GRPC_PORT = process.env.BC_GRPC_PORT || config.grpc.port;
const GRPC_URL = `${GRPC_HOST}:${GRPC_PORT}`;
const GRPC_MINER_URL = `${process.env.BC_GRPC_MINER_ADDRESS || 'gpuminer:50052'}`;

class RpcClient {
  // eslint-disable-line no-undef

  constructor() {

    const options = {};
    //const options = {
    //  'grpc.max_receive_message_length': 36600003,
    //  'grpc.max_concurrent_streams': 10000
    //}

    this._services = {
      bc: new BcClient(GRPC_URL, grpc.credentials.createInsecure(), options),
      miner: new MinerClient(GRPC_MINER_URL, grpc.credentials.createInsecure(), options),
      rover: new RoverClient(GRPC_URL, grpc.credentials.createInsecure(), options)
      //console.log(this._services.miner)
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