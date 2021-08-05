'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = newTx;
/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const { createNRGTransferTransaction } = require('bcjs/dist/transaction');
const { RpcTransaction, RpcTransactionResponse } = require('../../../protos/bc_pb');

function newTx(context, call, callback) {
  const response = new RpcTransactionResponse();
  const request = call.request;
  const wallet = context.server.engine.wallet;
  const fromAddress = request.getFromAddr().toLowerCase();

  wallet.getSpendableOutpointsList(fromAddress).then(async walletData => {
    const spendableOutpointsList = walletData.getSpendableOutpointsList().map(obj => {
      return obj.toObject();
    });

    const tx = await createNRGTransferTransaction(spendableOutpointsList, fromAddress, request.getPrivateKeyHex(), request.getToAddr(), request.getAmount(), request.getTxFee(), true);

    const response = new RpcTransactionResponse();
    context.server.engine.processTx(tx).then(res => {
      if (res) {
        console.log({ res });
        if (res.txHash && res.status) {
          response.setStatus(res.status);
          response.setTxHash(res.txHash);
        } else if (res.error) {
          response.setStatus('FAILED');
          response.setError(res.error);
        }
        response.setStatus('FAILED');
      }
      callback(null, response);
    });
  }).catch(err => {
    console.log({ err });
    context.logger.error(`Could not create tx, reason: ${err}'`);
    response.setStatus(1);
    response.setError(err);
    callback(null, response);
  });
}