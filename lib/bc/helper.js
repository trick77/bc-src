'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/**
 * Copyright (c) 2017-present, Overline-BSI developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const { BcBlock, BlockchainHeader } = require('@overline/proto/proto/core_pb');

const getBlockchainsBlocksCount = exports.getBlockchainsBlocksCount = block => {
  // $FlowFixMe
  const headersLists = Object.values(block.getBlockchainHeaders().toObject());
  return headersLists.reduce((acc, headersList) => acc + headersList.length, 0);
};

const isProcessRunning = exports.isProcessRunning = (processName, cb) => {
  const cmd = (() => {
    switch (process.platform) {
      case 'win32':
        return `tasklist`;
      case 'darwin':
        return `ps -ax | grep ${processName}`;
      case 'linux':
        return `ps -A`;
      default:
        return false;
    }
  })();
  require('child_process').exec(cmd, (err, stdout, stderr) => {
    cb(stdout.toLowerCase().indexOf(processName.toLowerCase()) > -1);
  });
};