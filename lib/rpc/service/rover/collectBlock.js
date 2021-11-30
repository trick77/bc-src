'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

exports.default = function (context, block, callback = () => {}) {
  const { server: { engine: { persistence } } } = context;
  // LOGIC HANDLED IN ENGINE

  context.roverEmitter.emit('collectBlock', { block });

  //context.roverEmitter.emit('collectBlock', { block })
  //context.emitter.emit('collectBlock', { block })
  if (context.pubsub && context.pubsub.publish) {
    context.pubsub.publish('rover.block', block);
  }
  //context.roverEmitter.emit('prepareBlock', { block })
  //return persistence.getBlockByHash(block.getHash(), blockchain).then((a) => {

  //  if (!a) {

  //    return persistence.putBlock(block, 0, blockchain).then(() => {
  //      context.roverEmitter.emit('collectBlock', { block })
  //      //context.emitter.emit('collectBlock', { block })
  //      //if (context.pubsub && context.pubsub.publish) {
  //      //  context.pubsub.publish('rover.block', block)
  //      //}
  //      if (context.pubsub && context.pubsub.publish) {
  //        context.pubsub.publish('rover.block', block)
  //      }
  //      return callback()
  //    })

  //  } else {
  //    context.roverEmitter.emit('collectBlock', { block })
  //  }

  //})
  //context.roverEmitter.emit('collectBlock', { block })
  //if (false) {
  //  return persistence.get(`${BC_SUPER_COLLIDER}.miner.mutex`).then((mutex) => {
  //    if (mutex === 'open') {
  //      return Promise.resolve(true)
  //    } else {
  //      log.info(`BC_MINER_MUTEX prevented ${blockchain} from restarting miner on block ${block.getHeight()}`)
  //    }
  //  }).catch((err) => {
  //    context.roverEmitter.emit('collectBlock', { block })
  //    context.emitter.emit('collectBlock', { block })
  //    if (context.pubsub && context.pubsub.publish) {
  //      context.pubsub.publish('rover.block', block)
  //    }
  //    log.warn(`error storing block ${err} from ${blockchain}`)
  //    return Promise.resolve(true)
  //  })

  //} else {
  //  context.roverEmitter.emit('collectBlock', { block })
  //  context.emitter.emit('collectBlock', { block })
  //  if (context.pubsub && context.pubsub.publish) {
  //    context.pubsub.publish('rover.block', block)
  //  }
  //  return Promise.resolve(true)

  //}
};

/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const { Null, Block } = require('@overline/proto/proto/core_pb');
const logging = require('../../../logger');
const { blockchainHeadersAreChain } = require('../../../bc/validation');
const BC_MINER_MUTEX = process.env.BC_MINER_MUTEX === 'true';
const BC_SUPER_COLLIDER = process.env.BC_SUPER_COLLIDER ? process.env.BC_SUPER_COLLIDER.toLowerCase() : 'bc';

const log = logging.getLogger(__filename);