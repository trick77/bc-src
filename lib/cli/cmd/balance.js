'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const { inspect } = require('util');

const { RpcClient } = require('../../rpc/client');
const { GetBalanceRequest, GetBalanceResponse } = require('../../protos/bc_pb');
const { getLogger } = require('../../logger');

const { Command } = require('commander');

const cmd = exports.cmd = (program, address) => {
  const rpcClient = new RpcClient();
  const log = getLogger(__filename);
  const req = new GetBalanceRequest([address.toLowerCase()]);

  log.info(`Sending: ${inspect(req.toObject())}`);

  return rpcClient.bc.getBalance(req, (err, res) => {
    if (err) {
      log.error(`Unable to get balance for ${address}, reason (${err.code}) ${err.toString()}`);
    } else {
      const logMsg = {
        'ConfirmedBalance': `${res.getConfirmed()}`,
        'UnconfirmedBalance': `${res.getUnconfirmed()}`,
        'CollateralizedBalance': `${res.getCollateralized()}`
      };
      const outputLine = Object.keys(logMsg).map(k => `${k}: ${logMsg[k]}`).join(', ');
      log.info(`Balance: { ${outputLine} }`);
    }
  });
};