'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getMarkedTxsForMatchedOrder;


const { GetMarkedTxs, GetOutPointRequest } = require('@overline/proto/proto/bc_pb'); /**
                                                                                      * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                                      *
                                                                                      * This source code is licensed under the MIT license found in the
                                                                                      * LICENSE file in the root directory of this source tree.
                                                                                      *
                                                                                      * 
                                                                                      */

function getMarkedTxsForMatchedOrder(context, call, callback) {
  const req = call.request;
  const index = req.getIndex();
  const hash = req.getHash();
  context.server.engine.utxoManager.getMarkedTxsForMatchedTx(hash, index).then(tx => {
    if (tx) {
      let response = new GetMarkedTxs();
      response.setTxsList(tx);
      callback(null, response);
    } else {
      callback(new Error(`Tx ${hash} not found`));
    }
  }).catch(err => {
    context.logger.error(`Could not get tx, reason: ${err}'`);
    callback(err);
  });
}