'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getBlocksHeight;


const { GetBlockHeightRequest, GetBlocksResponse } = require('@overline/proto/proto/bc_pb'); /**
                                                                                              * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                                              *
                                                                                              * This source code is licensed under the MIT license found in the
                                                                                              * LICENSE file in the root directory of this source tree.
                                                                                              *
                                                                                              * 
                                                                                              */

function getBlocksHeight(context, call, callback) {
  const req = call.request;
  const height = req.getHeight();

  context.server.engine.persistence.getBlocksByHeight(height).then(blocks => {
    const reply = new GetBlocksResponse();
    reply.setBlocksList(blocks);
    callback(null, reply);
  }).catch(err => {
    context.logger.error(`Could not get block, reason: ${err}'`);
    callback(err);
  });
}