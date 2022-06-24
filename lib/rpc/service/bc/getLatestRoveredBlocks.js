'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getLatestRoveredBlocks;


const LRU = require('lru-cache'); /**
                                   * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                   *
                                   * This source code is licensed under the MIT license found in the
                                   * LICENSE file in the root directory of this source tree.
                                   *
                                   * 
                                   */

const { Block } = require('@overline/proto/proto/core_pb');
const { GetRoveredBlocksResponse } = require('@overline/proto/proto/bc_pb');

let RoverManager = require('../../../rover/manager');

const cache = new LRU({
  allowStale: true,
  ttlResolution: 0,
  max: 100,
  ttl: 1000 * 12 // 12 seconds
});

function getLatestRoveredBlocks(context, call, callback) {
  const keys = Object.keys(RoverManager.rovers).map(rover => {
    return `${rover}.block.latest`;
  });

  const id = keys.join('.');
  const b = cache.get(id);

  if (b && b.getBlocksList) {
    callback(null, b);
  } else {

    const promises = keys.map(key => {
      return context.server.engine.persistence.get(key).then(res => {
        if (res) return res;else return null;
      }).catch(err => {
        if (err) {
          console.trace(err);
        }
        return null;
      });
    });

    return Promise.all(promises).then(blocks => {
      const reply = new GetRoveredBlocksResponse();
      reply.setBlocksList(blocks);
      cache.set(id, reply);
      callback(null, reply);
    }).catch(err => {
      context.logger.error(`Could not get latest rovered block, reason: ${err}'`);
      callback(err);
    });
  }
}