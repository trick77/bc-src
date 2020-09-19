'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getUnmatchedOrders;


const { GetBalanceRequest, GetOpenOrdersResponse } = require('../../../protos/bc_pb'); /**
                                                                                        * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                                        *
                                                                                        * This source code is licensed under the MIT license found in the
                                                                                        * LICENSE file in the root directory of this source tree.
                                                                                        *
                                                                                        * 
                                                                                        */

function getUnmatchedOrders(context, call, callback) {
  const getBalanceReq = call.request;
  const address = getBalanceReq.getAddress();
  const wallet = context.server.engine._wallet;

  wallet.getUnmatchedOrders(address).then(orders => {
    if (orders) {
      const response = new GetOpenOrdersResponse();
      response.setOrdersList(orders);
      callback(null, response);
    } else {
      callback(new Error(`Unmatched Orders for ${address} not found`));
    }
  }).catch(err => {
    callback(err);
  });
}