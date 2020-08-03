'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getTranfers;


const { TransferRequest } = require('../../../protos/bc_pb'); /**
                                                               * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                               *
                                                               * This source code is licensed under the MIT license found in the
                                                               * LICENSE file in the root directory of this source tree.
                                                               *
                                                               * 
                                                               */

const { internalToHuman, COIN_FRACS: { NRG } } = require('../../../core/coin');

function getTranfers(context, call, callback) {
  const req = call.request;
  const address = req.getAddress();
  let max = req.getMax();
  if (!max) max = 50;
  if (max > 50) max = 50;
  let from = req.getFrom();
  if (from != 'latest' || isNaN(from)) from = 'latest';

  context.server.engine._wallet.getTransferHistory(address, from, max).then(response => {
    if (response) callback(null, response);else callback(new Error(`Transfer history for ${address} not found`));
  }).catch(err => {
    callback(err);
  });
}