'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getBlockHeight;


const { GetRoveredBlockHeightRequest } = require('../../../protos/bc_pb'); /**
                                                                            * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                            *
                                                                            * This source code is licensed under the MIT license found in the
                                                                            * LICENSE file in the root directory of this source tree.
                                                                            *
                                                                            * 
                                                                            */

function getBlockHeight(context, call, callback) {
  const req = call.request;
  const blockchain = req.getBlockchain();
  const height = req.getHeight();

  context.server.engine.persistence.getBlockByHeight(height, blockchain).then(block => {
    if (block) callback(null, block);else callback(new Error(`${blockchain} Block #${height} not found`));
  }).catch(err => {
    context.logger.error(`Could not get block, reason: ${err}'`);
    callback(err);
  });
}