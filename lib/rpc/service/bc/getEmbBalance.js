'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getEmbBalance;

const { GetBalanceRequest, GetEmbBalanceResponse } = require('@overline/proto/proto/bc_pb'); /**
                                                                                              * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                                              *
                                                                                              * This source code is licensed under the MIT license found in the
                                                                                              * LICENSE file in the root directory of this source tree.
                                                                                              *
                                                                                              * 
                                                                                              */

function getEmbBalance(context, call, callback) {
  const getBalanceReq = call.request;
  const address = getBalanceReq.getAddress();
  context.server.engine.persistence.getMarkedBalanceData(address).then(balance => {
    const response = new GetEmbBalanceResponse([balance.toString()]);
    callback(null, response);
  }).catch(err => {
    callback(err);
  });
}