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
const { RpcTransaction, RpcUpdateFeedTransaction, RpcTransactionResponse, RpcTransactionResponseStatus } = require('@overline/proto/proto/bc_pb');

function updateFeed(context, call, callback) {
  try {
    const response = new RpcTransactionResponse();
    const request = call.request;
    const wallet = context.server.engine.wallet;

    context.logger.debug(request);

    // the owner address of the feed (not the sender address creating this tx)
    const ownerAddress = request.getOwnerAddr().toLowerCase();

    // the specific feed managed by the owner (it may or may not exist)
    const feedAddress = request.getFeedAddr().toLowerCase();

    // the owner and address combined creates the channel (basically long id for handle
    const channel = `${ownerAddress}@${feedAddress}`;

    // the sender sending the data or message
    const senderAddress = request.getSenderAddr().toLowerCase();

    // a field to check before parsing the data
    const dataType = request.getDataType();

    // a field to check before parsing the data
    const dataLength = request.getDataLength().toLowerCase();

    // the custom data of the message
    const data = request.getData();

    // OL sent in this TX if any
    const amount = request.getAmount();

    // the fee sent to the miners
    const txFee = request.getTxFee();

    // the tx panel holding the nonce point of the tx
    const txPanel = request.getTxPanel();

    // the tx nonce with minimum distance match
    const txNonce = request.getTxNonce();

    // the minmum distance score for the tx to enter the panel
    const minimumDistance = request.getMinimumDistance();

    //context.logger.debug(`update feed -> feed address: ${feedAddress}, channel: ${channel}, sender address: ${senderAddress}, datalength ${dataLength}, data: ${data}`)
    console.log(`--- UPDATE FEED --- \nfeed address: ${feedAddress} \nchannel: ${channel} \nsender address: ${senderAddress} \ndataType:${dataType} \ndatalength: ${dataLength} \ndata: ${data} \namount: ${amount} \ntx fee: ${txFee} \ntx panel: ${txPanel} \ntx nonce:${txNonce} \nminimum distance: ${minimumDistance}`);

    wallet.getSpendableOutpointsList(ownerAddress).then(async walletData => {
      const spendableOutpointsList = walletData.getSpendableOutpointsList().map(obj => {
        return obj.toObject();
      });

      // const tx = await createFeedTransaction(
      //  spendableOutpointsList,
      //  fromAddress,
      //  request.getPrivateKeyHex(),
      //  request.getFeedAddr(),
      //  request.getAmount(),
      //  request.getTxFee(),
      //  true
      // )

      const response = new RpcTransactionResponse();
      response.setTxHash('xxxx');
      response.setStatus(RpcTransactionResponseStatus.SUCCESS);
      // context.server.engine.processTx(tx).then((res) => {
      //  console.log({res})
      //  response.setStatus(res.status)
      //  response.setTxHash(res.txHash)
      //  response.setError(res.error)
      callback(null, response);
      // })
    }).catch(err => {
      context.logger.error('getSpendableOutpointsList failed with error = %o', err);
      response.setStatus(RpcTransactionResponseStatus.ERROR);
      response.setError(err.message);
      callback(null, response);
    });
  } catch (err) {
    context.logger.error('updateFeed handler failed with error = %o', err);
    const response = new RpcTransactionResponse();
    response.setStatus(RpcTransactionResponseStatus.ERROR);
    response.setError(err.message);
    callback(null, response);
  }
}