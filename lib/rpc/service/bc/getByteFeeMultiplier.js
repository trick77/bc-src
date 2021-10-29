'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getByteFeeMultiplier;


const { Transaction } = require('@overline/proto/proto/core_pb'); /**
                                                                   * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                   *
                                                                   * This source code is licensed under the MIT license found in the
                                                                   * LICENSE file in the root directory of this source tree.
                                                                   *
                                                                   * 
                                                                   */

const { GetByteFeeResponse } = require('@overline/proto/proto/bc_pb');

const rovers = require('../../../rover/manager').rovers;

function getByteFeeMultiplier(context, call, callback) {
  const reply = new GetByteFeeResponse();

  let fee = context.server.engine._txPendingPool.getByteFeeMultiplier();
  reply.setFee(fee);
  callback(null, reply);
}