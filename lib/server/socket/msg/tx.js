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
    const persistence = server._engine.persistence;

    persistence.getTransactionByHash(payload.data.hash).then(tx => {
      if (tx) {
        client.emit('tx.set', tx.toObject());
      } else {
        logger.error(`Unable to 'get.tx' ${JSON.stringify(payload.data)}`);
      }
    }).catch(err => {
      if (err) {
        logger.error(`Unable to 'get.tx' ${JSON.stringify(payload.data)}`);
      }
    });
  }
};