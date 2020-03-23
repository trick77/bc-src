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

const { config } = require('../../config');

const { Command } = require('commander');

const cmd = exports.cmd = program => {
  if (program.opts && program.opts().show) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  return program.help();
};