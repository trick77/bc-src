'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getBlocks;


const { BcBlock } = require('../../../protos/core_pb'); /**
                                                         * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                         *
                                                         * This source code is licensed under the MIT license found in the
                                                         * LICENSE file in the root directory of this source tree.
                                                         *
                                                         * 
                                                         */

const { GetBlocksResponse, GetBlocksRequests } = require('../../../protos/bc_pb');

const rovers = require('../../../rover/manager').rovers;

function reorganizeBlocks(blocks) {
  if (!blocks) {
    return [];
  }
  if (blocks.length < 2) {
    return blocks;
  }

  blocks = blocks.sort((a, b) => {
    if (a.getHeight() < b.getHeight()) {
      return -1;
    } else if (a.getHeight() > b.getHeight()) {
      return 1;
    }
    return 0;
  });

  console.log('start: ' + blocks[0].getHeight() + ' end: ' + blocks[blocks.length - 1].getHeight());

  const longestChain = blocks.reduce((all, block) => {
    let found = false;
    for (let hash of Object.keys(all)) {
      for (let mount of all[hash]) {
        if (block.getPreviousHash() === mount.getHash()) {
          found = true;
          all[hash].push(block);
        }
      }
    }
    if (!found) {
      all[block.getHash()] = [block];
    }
    return all;
  }, {});

  let best = false;

  for (let key of Object.keys(longestChain)) {
    if (!best) {
      best = longestChain[key];
    } else if (best.length < longestChain[key].length) {
      best = longestChain[key];
    }
  }

  if (best) {
    return best;
  }

  return blocsk;
}

function getBlocks(context, call, callback) {

  const req = call.request;
  const start = req.getStartHeight();
  const end = req.getEndHeight();

  if (start < 0 || end < start) callback(new Error(`incorrect start and end params`));

  let keys = [];
  for (let i = start; i <= end; i++) {
    keys.push(i);
  }

  const promises = keys.map(key => {
    return context.server.engine.persistence.getBlocksByHeight(key).then(res => {
      return res;
    }).catch(err => {
      return err;
    });
  });

  return Promise.all(promises).then(rawBlocks => {
    const reply = new GetBlocksResponse();
    const blocks = rawBlocks.reduce((all, b) => {});
    const orderedBlocks = reorganizeBlocks(rawBlocks);
    reply.setBlocksList(orderedBlocks);
    callback(null, reply);
  }).catch(err => {
    context.logger.error(`Could not get block, reason: ${err}'`);
    callback(err);
  });
}