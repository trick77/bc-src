'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getBlocksByRoveredHash;


const { GetBlocksByRoveredHashRequest } = require('@overline/proto/proto/bc_pb'); /**
                                                                                   * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                                   *
                                                                                   * This source code is licensed under the MIT license found in the
                                                                                   * LICENSE file in the root directory of this source tree.
                                                                                   *
                                                                                   * 
                                                                                   */

const { GetBlocksByRoveredHashResponse } = require('@overline/proto/proto/bc_pb');

function getBlocksByRoveredHash(context, call, callback) {
  const req = call.request;
  const hash = req.getHash();
  const blockchain = req.getBlockchain();

  context.server.engine.persistence.getBlocksByRoveredHash(hash, blockchain).then(blocks => {
    context.logger.debug('getBlocksByRoveredHash blocks = %O', blocks.map(b => b.toObject()));
    if (blocks) {
      let response = new GetBlocksByRoveredHashResponse();
      response.setBlocksList(blocks);
      callback(null, response);
    } else {
      callback(new Error(`${blockchain} Block ${hash} not found`));
    }
  }).catch(err => {
    context.logger.error(`Could not get block, reason: ${err}'`);
    callback(err);
  });
}