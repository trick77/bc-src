'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getBlockHeight;


const { GetBlockHeightRequest } = require('@overline/proto/proto/bc_pb'); /**
                                                                           * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                           *
                                                                           * This source code is licensed under the MIT license found in the
                                                                           * LICENSE file in the root directory of this source tree.
                                                                           *
                                                                           * 
                                                                           */

function getBlockHeight(context, call, callback) {
  const req = call.request;
  const height = req.getHeight();

  context.server.engine.persistence.getBlockByHeight(height).then(block => {
    if (block) callback(null, block);else callback(new Error(`Block #${height} not found`));
  }).catch(err => {
    context.logger.error(`Could not get block height, reason: ${err}'`);
    callback(err);
  });
}