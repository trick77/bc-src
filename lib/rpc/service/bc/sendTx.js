'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = sendTx;
/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const { RpcTransactionResponse } = require('@overline/proto/proto/bc_pb');

function sendTx(context, call, callback) {
  const tx = call.request;
  const response = new RpcTransactionResponse();
  // console.log({tx});
  context.server.engine.processTx(tx).then(res => {
    response.setStatus(res.status);
    response.setTxHash(res.txHash);
    response.setError(res.error);
    callback(null, response);
  }).catch(err => {
    console.trace(err);
    response.setStatus('error');
    response.setError(err.message);
    callback(null, response);
  });
}