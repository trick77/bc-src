'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getBlocks;


const { Block } = require('../../../protos/core_pb'); /**
                                                       * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                       *
                                                       * This source code is licensed under the MIT license found in the
                                                       * LICENSE file in the root directory of this source tree.
                                                       *
                                                       * 
                                                       */

const { GetRoveredBlocksResponse, GetRoveredBlocksRequests } = require('../../../protos/bc_pb');

const rovers = require('../../../rover/manager').rovers;

function getBlocks(context, call, callback) {

  const req = call.request;
  const blockchain = req.getBlockchain();
  const start = req.getStartHeight();
  const end = req.getEndHeight();

  if (start < 0 || end < start) callback(`incorrect start and end params`);

  let keys = [];
  for (let i = start; i <= end; i++) {
    keys.push({ blockchain, height: i });
  }

  const promises = keys.map(({ blockchain, height }) => {
    return context.server.engine.persistence.getBlockByHeight(blockchain, height).then(res => {
      if (res.getBlockchainConfirmationsInParentCount) {
        let b = new Block();
        b.setBlockchain(block.getBlockchain());
        b.setHash(block.getHash());
        b.setPreviousHash(block.getPreviousHash());
        b.setTimestamp(block.getTimestamp());
        b.setHeight(block.getHeight());
        b.setMerkleRoot(block.getMerkleRoot());
        b.setMarkedTxCount(block.getMarkedTxCount());
        b.setMarkedTxsList(b.getMarkedTxsList());
        res = b;
      }
      return res;
    }).catch(err => {
      return err;
    });
  });

  return Promise.all(promises).then(blocks => {
    const reply = new GetRoveredBlocksResponse();
    reply.setBlocksList(blocks);
    callback(null, reply);
  }).catch(err => {
    context.logger.error(`Could not get block, reason: ${err}'`);
    callback(err);
  });
}