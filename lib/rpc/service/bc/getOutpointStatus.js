'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getOutpointStatus;


const { GetOutPointRequest, GetOutPointStatusResponse } = require('@overline/proto/proto/bc_pb'); /**
                                                                                                   * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                                                   *
                                                                                                   * This source code is licensed under the MIT license found in the
                                                                                                   * LICENSE file in the root directory of this source tree.
                                                                                                   *
                                                                                                   * 
                                                                                                   */

const { OutPoint } = require('@overline/proto/proto/core_pb');

function getOutpointStatus(context, call, callback) {
  const req = call.request;
  const hash = req.getHash();
  const index = req.getIndex();
  const reply = new GetOutPointStatusResponse();

  const outpoint = new OutPoint();
  outpoint.setHash(hash);
  outpoint.setIndex(index);

  context.server.engine.persistence.isOutPointUnspent(hash, index).then(unspent => {
    unspent = unspent && !context.server.engine._txPendingPool.isBeingSpent(outpoint);
    reply.setUnspent(unspent);
    callback(null, reply);
  }).catch(err => {
    context.logger.error(`Could not get tx, reason: ${err}'`);
    callback(err);
  });
}