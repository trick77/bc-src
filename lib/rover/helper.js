'use strict';

/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const { format } = require('util');
const path = require('path');
const { debugSaveObject } = require('../debug');
const { Block, MarkedTransaction } = require('../protos/core_pb');
const { RoverClient } = require('../protos/rover_grpc_pb');
const { SettleTxCheckReq } = require('../protos/rover_pb');
const { getLogger } = require('../logger');
const logger = getLogger(__filename);
const BN = require('bn.js');
const BC_MINER_MUTEX = process.env.BC_MINER_MUTEX === 'true';

// from, to, value, chain, txid, block_height, token_type

async function createUnifiedBlock(isStandalone, block, roverRpc, transform, oldBlock = false) {
  try {
    let unifiedBlock;
    unifiedBlock = await transform(roverRpc, block, isStandalone);
    if (!unifiedBlock.toObject) {
      logger.debug(`block is malformed, unified block cannot be created`);
      return false;
    }
    const obj = unifiedBlock.toObject();

    const dir = path.join(obj.blockchain, 'block');
    const filename = `${obj.timestamp}-${obj.hash}.json`;

    debugSaveObject(path.join(dir, 'raw', filename), block);
    debugSaveObject(path.join(dir, 'unified', filename), unifiedBlock.toObject());

    // $FlowFixMe
    // let hash = (obj.blockchain === 'btc' ? obj.hash.replace(/^0*/, '').slice(0, 8) : obj.hash.slice(0, 8))
    // logger.debug(`unified block built from ${obj.blockchain}: ${hash}, height: ${obj.height}, markedTxsListLength: ${obj.markedTxsList.length}`)
    return unifiedBlock;
  } catch (e) {
    logger.warn(`Error while transforming block ${e.stack}`);
    throw e;
  }
}

function isBeforeSettleHeight(checks, roverRpc, blockHash) {
  let req = new SettleTxCheckReq();
  req.setPossibleTransactionsList(checks);
  req.setBlockHash(blockHash);

  return new Promise(function (resolve, reject) {
    const t = setTimeout(() => {
      reject(new Error('request timed out'));
    }, 35001);
    roverRpc.isBeforeSettleHeight(req, function (err, response) {
      clearTimeout(t);
      if (err) {
        console.trace(err);
        logger.error(format('isBeforeSettleHeight response error = %o, request = %o', err, req.toObject()));
        resolve(false);
      } else {
        if (response && response.getMarkedTransactionsList && response.getMarkedTransactionsList().length > 0) {
          // console.log({ err, response: response.toObject() })
        }
        try {
          resolve(response.getMarkedTransactionsList());
        } catch (e) {
          console.trace(e);
          logger.warn(format('error responding to isBeforeSettleHeight call, err = %O', e));
          reject(e);
        }
      }
    });
  });
}

module.exports = {
  createUnifiedBlock: createUnifiedBlock,
  isBeforeSettleHeight: isBeforeSettleHeight
};