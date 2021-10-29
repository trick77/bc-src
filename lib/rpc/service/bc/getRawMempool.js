'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getRawMempool;


const { Transaction } = require('@overline/proto/proto/core_pb'); /**
                                                                   * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                   *
                                                                   * This source code is licensed under the MIT license found in the
                                                                   * LICENSE file in the root directory of this source tree.
                                                                   *
                                                                   * 
                                                                   */

const { GetRawMempoolResponse } = require('@overline/proto/proto/bc_pb');

const rovers = require('../../../rover/manager').rovers;

function getRawMempool(context, call, callback) {
  const reply = new GetRawMempoolResponse();

  let txs = context.server.engine._txPendingPool.getRawMempool();
  reply.setTransactionsList(txs);
  callback(null, reply);
}