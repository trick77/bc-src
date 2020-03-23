'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getBlockHash;


const { GetRoveredBlockHashRequest } = require('../../../protos/bc_pb'); /**
                                                                          * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                          *
                                                                          * This source code is licensed under the MIT license found in the
                                                                          * LICENSE file in the root directory of this source tree.
                                                                          *
                                                                          * 
                                                                          */

function getBlockHash(context, call, callback) {
  const req = call.request;
  const blockchain = req.getBlockchain();
  const hash = req.getHash();

  context.server.engine.persistence.getBlockByHash(hash, blockchain).then(block => {
    if (block) callback(null, block);else callback(new Error(`${blockchain} Block ${hash} not found`));
  }).catch(err => {
    context.logger.error(`Could not get block, reason: ${err}'`);
    callback(err);
  });
}