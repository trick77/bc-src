'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = stats;


const { StatsResponse } = require('../../../protos/bc_pb'); /**
                                                             * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                             *
                                                             * This source code is licensed under the MIT license found in the
                                                             * LICENSE file in the root directory of this source tree.
                                                             *
                                                             * 
                                                             */

function stats(context, call, callback) {
  const reply = new StatsResponse();
  reply.setLatestGpuMinerUpdate(context.server.engine._latestGpuMinerUpdate);
  callback(null, reply);
}