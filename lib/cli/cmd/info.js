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

const { Command } = require('commander');
const { getOsInfo } = require('../../helper/os');

const cmd = exports.cmd = program => {
  // return program.help()
  //
  // if (!program.opts) {
  //   return program.help()
  // }
  //

  if (program.opts().all || program.opts().machine) {
    console.log(JSON.stringify(getOsInfo(), null, 2));
  }
};