'use strict';

/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const logging = require('../../../logger');
const logger = logging.getLogger(__filename);

module.exports = {
  get: (server, client, payload) => {
    const id = payload.data.id;
    const persistence = server._engine.persistence;
    persistence.getBlockByHeight(id).then(block => {
      client.emit('block.set', block.toObject());
    }).catch(err => {
      persistence.getBlockByHash(id).then(block => {
        client.emit('block.set', block.toObject());
      }).catch(err => {
        if (err) logger.error("Unable to 'get.block' " + id);
      });
    });
  }
};