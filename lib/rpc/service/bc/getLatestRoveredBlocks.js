'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getLatestRoveredBlocks;


const { Block } = require('../../../protos/core_pb'); /**
                                                       * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                       *
                                                       * This source code is licensed under the MIT license found in the
                                                       * LICENSE file in the root directory of this source tree.
                                                       *
                                                       * 
                                                       */

const { GetRoveredBlocksResponse } = require('../../../protos/bc_pb');

let RoverManager = require('../../../rover/manager');

function getLatestRoveredBlocks(context, call, callback) {
  const keys = Object.keys(RoverManager.rovers).map(rover => {
    return `${rover}.block.latest`;
  });

  const promises = keys.map(key => {
    return context.server.engine.persistence.get(key).then(res => {
      if (res) return res;else return null;
    }).catch(err => {
      if (err) {
        console.log(err);
      }
      return null;
    });
  });

  return Promise.all(promises).then(blocks => {
    const reply = new GetRoveredBlocksResponse();
    reply.setBlocksList(blocks);
    callback(null, reply);
  }).catch(err => {
    context.logger.error(`Could not get block, reason: ${err}'`);
  });
}