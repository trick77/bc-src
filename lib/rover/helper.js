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
const { Block, MarkedTransaction } = require('../protos/core_pb');
const { RoverClient } = require('../protos/rover_grpc_pb');
const { MarkedTxsReq, SettleTxCheckReq } = require('../protos/rover_pb');
const { getLogger } = require('../logger');
const logger = getLogger(__filename);
const BN = require('bn.js');
const BC_MINER_MUTEX = process.env.BC_MINER_MUTEX === 'true';

// from, to, value, chain, txid, block_height, token_type

async function createUnifiedBlock(isStandalone, block, roverRpc, transform, oldBlock = false) {
  return new Promise((resolve, reject) => {
    try {
      process.nextTick(async () => {
        let unifiedBlock;
        unifiedBlock = await transform(roverRpc, block, isStandalone);
        if (!unifiedBlock || !unifiedBlock.toObject) {
          logger.debug('block is malformed, unified block cannot be created, block was = %O', block);
          return false;
        }
        //
        // const obj = unifiedBlock.toObject()
        // const dir = path.join(obj.blockchain, 'block')
        // const filename = `${obj.timestamp}-${obj.hash}.json`
        // debugSaveObject(path.join(dir, 'raw', filename), block)
        // debugSaveObject(path.join(dir, 'unified', filename), obj)

        // $FlowFixMe
        // let hash = (obj.blockchain === 'btc' ? obj.hash.replace(/^0*/, '').slice(0, 8) : obj.hash.slice(0, 8))
        // logger.debug(`unified block built from ${obj.blockchain}: ${hash}, height: ${obj.height}, markedTxsListLength: ${obj.markedTxsList.length}`)
        return resolve(unifiedBlock);
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

    const t = setTimeout(() => {
      logger.error('isBeforeSettleHeight no response');
      resolve(false);
      //logger.info(`re-requesting <- block ${blockHash}`)
      //const tm = setTimeout(() => {
      //  logger.error(`timeout occured for block ${blockHash}`)
      //  reject(new Error('request timed out'))
      //}, 110000)

      //roverRpc.isBeforeSettleHeight(req, function (err, response) {
      //  clearTimeout(tm)
      //  if (err) {
      //    logger.error('isBeforeSettleHeight response error = %o, request = %o', err, req.toObject())
      //    resolve(false)
      //  } else {
      //    if (response && response.getMarkedTransactionsList && response.getMarkedTransactionsList().length > 0) {
      //      // console.log({ err, response: response.toObject() })
      //    }
      //    try {
      //      resolve(response.getMarkedTransactionsList())
      //    } catch (e) {
      //      logger.warn('error responding to isBeforeSettleHeight call, err = %O', e)
      //      reject(e)
      //    }
      //  }
      //})
    }, 113000);

    roverRpc.isBeforeSettleHeight(req, function (err, response) {
      clearTimeout(t);
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