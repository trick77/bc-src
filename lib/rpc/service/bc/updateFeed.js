'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = updateFeed;
/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const { createFeedTransaction } = require('bcjs/dist/transaction');
const { RpcTransaction, RpcUpdateFeedTransaction, RpcTransactionResponse } = require('../../../protos/bc_pb');

function updateFeed(context, call, callback) {
  try {
    const response = new RpcTransactionResponse();
    const request = call.request;
    const wallet = context.server.engine.wallet;

    // the owner address of the feed
    const ownerAddress = request.getOwnerAddr().toLowerCase();

    // the specific feed managed by the owner (it may or may not exist)
    const feedAddress = request.getFeedAddr().toLowerCase();

    // the owner and address combined creates the channel
    const channel = `${fromAddress}@${feedAddress}`;

    // the sender sending the data or message
    const senderAddress = request.getSenderAddr().toLowerCase();

    // a field to check before parsing the data
    const dataLength = request.getDataLength().toLowerCase();

    // the custom data of the message
    const data = request.getData().toLowerCase();

    //console.log(`from: ${fromAddress}, tx fee: ${request.getTxFee()}, amount: ${request.getAmount()}, feed addr: ${request.getFeedAddr()}, priv: ${request.getPrivateKeyHex()}`)

    wallet.getSpendableOutpointsList(fromAddress).then(async walletData => {
      const spendableOutpointsList = walletData.getSpendableOutpointsList().map(obj => {
        return obj.toObject();
      });

      //const tx = await createFeedTransaction(
      //  spendableOutpointsList,
      //  fromAddress,
      //  request.getPrivateKeyHex(),
      //  request.getFeedAddr(),
      //  request.getAmount(),
      //  request.getTxFee(),
      //  true
      //)

      const response = new RpcTransactionResponse();
      //context.server.engine.processTx(tx).then((res) => {
      //  console.log({res})
      //  response.setStatus(res.status)
      //  response.setTxHash(res.txHash)
      //  response.setError(res.error)
      callback(null, response);
      //})
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