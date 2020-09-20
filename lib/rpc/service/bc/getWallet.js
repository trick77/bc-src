'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getWallet;


const { GetBalanceRequest } = require('../../../protos/bc_pb'); /**
                                                                 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                 *
                                                                 * This source code is licensed under the MIT license found in the
                                                                 * LICENSE file in the root directory of this source tree.
                                                                 *
                                                                 * 
                                                                 */

const { internalToHuman, COIN_FRACS: { NRG } } = require('../../../core/coin');
const { Wallet } = require('../../../bc/wallet');

function getWallet(context, call, callback) {
  const getBalanceReq = call.request;
  const address = getBalanceReq.getAddress();
  const wallet = context.server.engine._wallet;

  wallet.getWalletData(address).then(walletData => {
    if (walletData) callback(null, walletData);else callback(`Wallet Data for ${address} not found`);
  }).catch(err => {
    callback(err);
  });
}