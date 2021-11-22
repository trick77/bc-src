'use strict';

/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const path = require('path');
const { debugSaveObject } = require('../debug');
const { Block, MarkedTransaction } = require('@overline/proto/proto/core_pb');
const { RoverClient } = require('@overline/proto/proto/rover_grpc_pb');
const { MarkedTxsReq, SettleTxCheckReq } = require('@overline/proto/proto/rover_pb');
const { getLogger } = require('../logger');
const { queue, timeout } = require('async');
const logger = getLogger(__filename);
const BN = require('bn.js');
const BC_MINER_MUTEX = process.env.BC_MINER_MUTEX === 'true';

// from, to, value, chain, txid, block_height, token_type

const unifiedBlockQueue = queue((task, callback) => {
  task.transform(task.roverRpc, task.block, task.isStandalone).then(unifiedBlock => {
    if (!unifiedBlock || !unifiedBlock.toObject) {
      logger.debug('block is malformed, unified block cannot be created, block was = %O', task.block);
      return callback(false); // eslint-disable-line
    }
    return callback(unifiedBlock);
  }).catch(err => {
    logger.error(err);
    return callback(false); // eslint-disable-line
  });
}, 1);

async function createUnifiedBlock(isStandalone, block, roverRpc, transform, oldBlock = false) {
  return new Promise((resolve, reject) => {
    try {

      if (unifiedBlockQueue.length() > 4) {
        unifiedBlockQueue.process();
      }

      const task = { transform, roverRpc, block, isStandalone };
      unifiedBlockQueue.push(task, ub => {
        return resolve(ub);
      });
    } catch (e) {
      logger.warn(`Error while transforming block ${e.stack}`);
      //return createUnifiedBlock(isStandalone, block, roverRpc, transform, oldBlock)
      return reject(e);
      // throw e
    }
  });
}

function isBeforeSettleHeight(checks, roverRpc, blockHash, blockchain) {
  return new Promise(function (resolve, reject) {
    let bridgedChain = blockchain || '';
    let req = new SettleTxCheckReq();
    req.setBridgedChain(bridgedChain);
    req.setPossibleTransactionsList(checks);
    req.setBlockHash(blockHash);

    roverRpc.isBeforeSettleHeight(req, function (err, response) {
      if (err) {
        logger.error('isBeforeSettleHeight response error = %o, request = %o', err, req.toObject());
        resolve(false);
      } else {
        if (response && response.getMarkedTransactionsList && response.getMarkedTransactionsList().length > 0) {
          // console.log({ err, response: response.toObject() })
        }
        try {
          resolve(response.getMarkedTransactionsList());
        } catch (e) {
          logger.warn('error responding to isBeforeSettleHeight call, err = %O', e);
          reject(e);
        }
      }
    });
  });
}

function getQueuedMarkedTxs(checks, roverRpc, blockHash, blockchain) {
  return new Promise((resolve, reject) => {
    try {
      let req = new MarkedTxsReq();
      req.setMarkedTransactionsList(checks);
      req.setBlockHash(blockHash);
      req.setBlockchain(blockchain);
      roverRpc.getQueuedMarkedTxs(req, (err, response) => {
        if (err) {
          logger.error('getQueuedMarkedTxs call endedn with error, e = %O', err);
          resolve(false);
        } else {
          resolve(response.getMarkedTransactionsList());
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  createUnifiedBlock: createUnifiedBlock,
  isBeforeSettleHeight: isBeforeSettleHeight,
  getQueuedMarkedTxs: getQueuedMarkedTxs
};