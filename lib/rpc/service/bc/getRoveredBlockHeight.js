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

const { Block } = require('../../../protos/core_pb');

function getBlockHeight(context, call, callback) {
  const req = call.request;
  const blockchain = req.getBlockchain();
  const height = req.getHeight();

  context.server.engine.persistence.getBlockByHeight(height, blockchain).then(block => {

    if (block) {
      if (block.getBlockchainConfirmationsInParentCount) {
        let b = new Block();
        b.setBlockchain(block.getBlockchain());
        b.setHash(block.getHash());
        b.setPreviousHash(block.getPreviousHash());
        b.setTimestamp(block.getTimestamp());
        b.setHeight(block.getHeight());
        b.setMerkleRoot(block.getMerkleRoot());
        b.setMarkedTxCount(block.getMarkedTxCount());
        b.setMarkedTxsList(b.getMarkedTxsList());
        block = b;
      }
      callback(null, block);
    } else callback(new Error(`${blockchain} Block #${height} not found`));
  }).catch(err => {
    context.logger.error(`Could not get block, reason: ${err}'`);
    callback(err);
  });
}