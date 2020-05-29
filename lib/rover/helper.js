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
const { SettleTxCheckReq } = require('../protos/rover_pb');
const { getLogger } = require('../logger');
const logger = getLogger(__filename);
const BN = require('bn.js');

// from, to, value, chain, txid, block_height, token_type

// const stringifyObject = (obj) => JSON.stringify(obj, null, 2)

async function createUnifiedBlock(isStandalone, block, roverRpc, transform, oldBlock = false) {

  try {
    let unifiedBlock;
    unifiedBlock = await transform(roverRpc, block, isStandalone);
    if (!unifiedBlock.toObject) {
      logger.debug(`block is malformed, unified block cannot be created`);
      return Promise.resolve(false);
    }
    const obj = unifiedBlock.toObject();

    const dir = path.join(obj.blockchain, 'block');
    const filename = `${obj.timestamp}-${obj.hash}.json`;

    debugSaveObject(path.join(dir, 'raw', filename), block);
    debugSaveObject(path.join(dir, 'unified', filename), unifiedBlock.toObject());

    // $FlowFixMe
    let hash = obj.blockchain === 'btc' ? obj.hash.replace(/^0*/, '').slice(0, 8) : obj.hash.slice(0, 8);
    //logger.debug(`unified block built from ${obj.blockchain}: ${hash}, height: ${obj.height}, markedTxsListLength: ${obj.markedTxsList.length}`)
    return unifiedBlock;
  } catch (e) {
    logger.warn(`Error while transforming block ${e.stack}`);
    return Promise.reject(e);
  }
}

function isBeforeSettleHeight(checks, roverRpc, blockHash) {
  let req = new SettleTxCheckReq();
  for (const check of checks) {
    let [addrFrom, addrTo, value, bridgedChain, txId, blockHeight, tokenType] = check;
    if (BN.isBN(value)) {
      value = value.toBuffer();
    } else if (!Buffer.isBuffer(value)) {
      throw new Error('value must be either BN or Buffer');
    }

    const pTx = new SettleTxCheckReq.PossibleTransaction();
    pTx.setAddrFrom(addrFrom);
    pTx.setAddrTo(addrTo);
    pTx.setValue(new Uint8Array(value));
    pTx.setBridgedChain(bridgedChain);
    pTx.setTxId(txId);
    pTx.setBlockHeight(blockHeight);
    pTx.setTokenType(tokenType);
    req.addPossibleTransactions(pTx);
  }
  req.setBlockHash(blockHash);
  return new Promise(function (resolve, reject) {
    roverRpc.isBeforeSettleHeight(req, function (err, response) {
      if (err) {
        // console.log({ err, response })
        logger.error('isBeforeSettleHeight-response-err:', err.toString(), JSON.stringify(req.toObject()));
        resolve(false);
      } else {
        if (response && response.getMarkedTransactionsList && response.getMarkedTransactionsList().length > 0) {
          // console.log({ err, response: response.toObject() })
        }
        try {
          resolve(response.getMarkedTransactionsList());
        } catch (e) {
          console.trace(e);
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