'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getBalance;


const { GetBalanceRequest, GetBalanceResponse } = require('@overline/proto/proto/bc_pb'); /**
                                                                                           * Copyright (c) 2017-present, Overline-BSI developers, All rights reserved.
                                                                                           *
                                                                                           * This source code is licensed under the MIT license found in the
                                                                                           * LICENSE file in the root directory of this source tree.
                                                                                           *
                                                                                           * 
                                                                                           */

const { internalToHuman, COIN_FRACS: { NRG } } = require('../../../core/coin');

function getBalance(context, call, callback) {
  const getBalanceReq = call.request;
  const address = getBalanceReq.getAddress();
  const wallet = context.server.engine._wallet;

  wallet.getBalanceData(address).then(balanceData => {
    context.server.engine.persistence.get(`bc.block.latest`).then(block => {
      const { confirmed, unconfirmed, collateralized, unlockable } = balanceData;
      const response = new GetBalanceResponse([block ? block.getHeight() : 0, confirmed.toString(), unconfirmed.toString(), collateralized.toString(), unlockable.toString()]);
      callback(null, response);
    }).catch(err => {
      callback(err);
    });
  }).catch(err => {
    callback(err);
  });
}