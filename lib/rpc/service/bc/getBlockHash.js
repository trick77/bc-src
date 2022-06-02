'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getBlockHash;


const { GetBlockHashRequest } = require('@overline/proto/proto/bc_pb'); /**
                                                                         * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                         *
                                                                         * This source code is licensed under the MIT license found in the
                                                                         * LICENSE file in the root directory of this source tree.
                                                                         *
                                                                         * 
                                                                         */

const LRU = require('lru-cache');

const cache = new LRU({
  allowStale: true,
  maxSize: 100
});

function getBlockHash(context, call, callback) {
  const req = call.request;
  const hash = req.getHash();
  const b = cache.get(hash);

  if (b && b.getHash) {
    callback(null, b);
  } else {
    context.server.engine.persistence.getBlockByHash(hash).then(block => {
      if (block) {
        cache.set(hash, block);
        callback(null, block);
      } else {
        callback(new Error(`Block ${hash} not found`));
      }
    }).catch(err => {
      context.logger.error(`Could not get block hash, reason: ${err}'`);
      callback(err);
    });
  }
}