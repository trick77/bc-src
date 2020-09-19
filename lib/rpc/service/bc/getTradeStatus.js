'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getOutPointStatus;


const { GetOutPointRequest, GetTradeStatusResponse } = require('../../../protos/bc_pb'); /**
                                                                                          * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                                          *
                                                                                          * This source code is licensed under the MIT license found in the
                                                                                          * LICENSE file in the root directory of this source tree.
                                                                                          *
                                                                                          * 
                                                                                          */

const { OutPoint } = require('../../../protos/core_pb');

function getOutPointStatus(context, call, callback) {
  const req = call.request;
  const hash = req.getHash();
  const index = req.getIndex();
  const reply = new GetTradeStatusResponse();

  context.server.engine._dex.tradeStatus(hash, index).then(status => {
    reply.setStatus(status);
    callback(null, reply);
  }).catch(err => {
    context.logger.error(`Could not get tx, reason: ${err}'`);
    callback(err);
  });
}