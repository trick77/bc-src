'use strict';

/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const { range, reverse } = require('ramda');
const logging = require('../../../logger');
const logger = logging.getLogger(__filename);

const blockGet = (persistence, id) => persistence.getBlockByHeight(id);

module.exports = {
  get: (server, client, payload) => {
    let firstBlock = null;
    const persistence = server._engine.persistence;
    blockGet(persistence, payload.data.id).then(block => {
      firstBlock = block;
      const firstBlockHeight = firstBlock.getHeight();
      const count = Math.min(payload.data.count || 10, firstBlockHeight) - 1;
      logger.info('requesting block height from server');
      if (!firstBlock) {
        return [];
      }
      const cycle = async (hash, blocks, done) => {
        if (done >= count) {
          return blocks;
        }
        const b = await persistence.getBlockByHash(hash);
        if (!b) {
          return blocks;
        } else {
          blocks.push(b);
          done++;
          return cycle(b.getPreviousHash(), blocks, done);
        }
      };
      return cycle(firstBlock.getPreviousHash(), [], 0);
    }).then(blocks => {
      client.emit('blocks.set', [firstBlock && firstBlock.toObject(), ...blocks.filter(b => b).map(block => block.toObject())]);
    }).catch(err => {
      if (err) {
        logger.error(`Unable to 'get.blocks', err: ${err.toString()}`);
      }
    });
  }
};