'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getLatestBlock;

const LRU = require('lru-cache'); /**
                                   * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                   *
                                   * This source code is licensed under the MIT license found in the
                                   * LICENSE file in the root directory of this source tree.
                                   *
                                   * 
                                   */

const cache = new LRU({
  allowStale: true,
  ttlResolution: 0,
  max: 100,
  ttl: 1000 * 12 // 12 seconds
});

function getLatestBlock(context, call, callback) {
  const id = `bc.block.latest`;
  const b = cache.get(id);
  if (b && b.getHash) {
    callback(null, b);
  } else {
    context.server.engine.persistence.get(id).then(block => {
      if (block && block.getHash) {
        cache.set(id, block);
        callback(null, block);
      } else {
        callback(new Error(`Latest Block not found`));
      }
    }).catch(err => {
      console.trace(err);
      context.logger.error(`Could not get latest block, reason: ${err}'`);
      callback(err);
    });
  }
}