'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getTxClaimedBy;

const { GetOutPointRequest } = require('@overline/proto/proto/bc_pb'); /**
                                                                        * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                        *
                                                                        * This source code is licensed under the MIT license found in the
                                                                        * LICENSE file in the root directory of this source tree.
                                                                        *
                                                                        * 
                                                                        */

function getTxClaimedBy(context, call, callback) {
  const req = call.request;
  const hash = req.getHash();
  const index = req.getIndex();

  context.server.engine.persistence.getTxClaimedBy(hash, index).then(tx => {
    callback(null, tx);
  }).catch(err => {
    context.logger.error(`Could not get tx, reason: ${err}'`);
    callback(err);
  });
}