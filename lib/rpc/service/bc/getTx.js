'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getTx;


const { GetTxRequest } = require('../../../protos/bc_pb'); /**
                                                            * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                            *
                                                            * This source code is licensed under the MIT license found in the
                                                            * LICENSE file in the root directory of this source tree.
                                                            *
                                                            * 
                                                            */

function getTx(context, call, callback) {
  const req = call.request;
  const hash = req.getHash();
  context.server.engine.persistence.getTransactionByHash(hash).then(tx => {
    if (tx) callback(null, tx);else callback(`Tx ${hash} not found`);
  }).catch(err => {
    context.logger.error(`Could not get tx, reason: ${err}'`);
    callback(err);
  });
}