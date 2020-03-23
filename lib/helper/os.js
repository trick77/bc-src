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

const os = require('os');

const getOsInfo = exports.getOsInfo = () => {
  return {
    arch: os.arch(),
    cpus: os.cpus(),
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    mem: os.totalmem(),
    network: os.networkInterfaces(),
    type: os.type()
  };
};