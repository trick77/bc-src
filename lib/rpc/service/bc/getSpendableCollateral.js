'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getSpendableCollateral;


const { GetSpendableCollateralRequest, GetSpendableCollateralResponse } = require('@overline/proto/proto/bc_pb'); /**
                                                                                                                   * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                                                                   *
                                                                                                                   * This source code is licensed under the MIT license found in the
                                                                                                                   * LICENSE file in the root directory of this source tree.
                                                                                                                   *
                                                                                                                   * 
                                                                                                                   */

function getSpendableCollateral(context, call, callback) {
  const getBalanceReq = call.request;
  const address = getBalanceReq.getAddress();
  const wallet = context.server.engine.wallet;

  wallet.getBalanceData(address).then(balanceData => {
    if (balanceData) {
      const response = new GetSpendableCollateralResponse();
      const { collateralizedSpendableOutPoints } = balanceData;
      response.setOutpoints(collateralizedSpendableOutPoints);
      callback(null, response);
    } else callback(new Error(`Spendable Collateral for ${address} not found`));
  }).catch(err => {
    callback(err);
  });
}