'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getLatestBlock;
function getLatestBlock(context, call, callback) {
  const id = `bc.block.latest`;
  context.server.engine.persistence.get(id).then(block => {
    if (block) callback(null, block);else callback(new Error(`Latest Block not found`));
  }).catch(err => {
    context.logger.error(`Could not get block, reason: ${err}'`);
    callback(err);
  });
} /**
   * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *
   * 
   */