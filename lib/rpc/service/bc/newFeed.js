'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = newFeed;
/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const { createFeedTransaction } = require('bcjs/dist/transaction');
const { RpcTransaction, RpcFeedTransaction, RpcTransactionResponse } = require('@overline/proto/proto/bc_pb');

function newFeed(context, call, callback) {
  try {
    const response = new RpcTransactionResponse();
    const request = call.request;
    const wallet = context.server.engine.wallet;
    const fromAddress = request.getOwnerAddr().toLowerCase();

    console.log(`from: ${fromAddress}, tx fee: ${request.getTxFee()}, amount: ${request.getAmount()}, feed addr: ${request.getFeedAddr()}, priv: ${request.getPrivateKeyHex()}`);

    wallet.getSpendableOutpointsList(fromAddress).then(async walletData => {
      const spendableOutpointsList = walletData.getSpendableOutpointsList().map(obj => {
        return obj.toObject();
      });
      const tx = await createFeedTransaction(spendableOutpointsList, fromAddress, request.getPrivateKeyHex(), request.getFeedAddr(), request.getAmount(), request.getTxFee(), true);
      const response = new RpcTransactionResponse();
      context.server.engine.processTx(tx).then(res => {
        console.log({ res });
        response.setStatus(res.status);
        response.setTxHash(res.txHash);
        response.setError(res.error);
        callback(null, response);
      });
    }).catch(err => {
      console.log({ err });
      context.logger.error(`Could not create tx, reason: ${err}'`);
      response.setStatus(1);
      response.setError(err);
      callback(null, response);
    });
  } catch (e) {
    console.trace(e);
    const response = new RpcTransactionResponse();
    callback(null, response);
  }
}