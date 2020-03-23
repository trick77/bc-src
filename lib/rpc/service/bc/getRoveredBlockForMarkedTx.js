'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getRoveredBlockForMarkedTx;


const { GetMarkedTxRequest } = require('../../../protos/bc_pb'); /**
                                                                  * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                  *
                                                                  * This source code is licensed under the MIT license found in the
                                                                  * LICENSE file in the root directory of this source tree.
                                                                  *
                                                                  * 
                                                                  */
function getRoveredBlockForMarkedTx(context, call, callback) {
  const req = call.request;
  const hash = req.getHash();
  const blockchain = req.getBlockChain();
  const id = `${blockchain}.txblock.${hash}`;

  context.server.engine.persistence.get(id).then(key => {
    if (key) {
      let blockHash = key.split('.')[2];
      if (blockHash) {
        context.server.engine.persistence.getBlockByHash(blockHash, blockchain).then(block => {
          if (block) callback(null, block);else callback(new Error(`Could not get ${blockchain} block for tx ${hash}`));
        }).catch(err => {
          context.logger.error(`Could not get block, reason: ${err}'`);
          callback(new Error(`Could not get ${blockchain} block for tx ${hash}`));
        });
      }
    } else {
      callback(new Error(`Could not get ${blockchain} block for tx ${hash}`));
    }
  }).catch(err => {
    context.logger.error(`Could not get tx, reason: ${err}'`);
    callback(err);
  });
}