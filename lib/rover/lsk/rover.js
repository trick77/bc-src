#! /usr/bin/env node
'use strict';

/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const process = require('process');
const { merge } = require('ramda');
const logging = require('../../logger');

const globalLog = logging.getLogger(__filename);
// setup logging of unhandled rejections
process.on('unhandledRejection', err => {
  // $FlowFixMe
  globalLog.debug(`Rejected promise, trace:\n${err.stack}`);
});
process.on('uncaughtException', err => {
  // $FlowFixMe
  globalLog.error('Uncaught exception, e = %O', err);
});

const Controller = require('./controller').default;
const { config } = require('../../config');

const ROVER_TITLE = 'bc-rover-lsk';
const IS_STANDALONE = !process.send;

/**
 * LSK Rover entrypoint
 */
const main = function () {
  process.title = ROVER_TITLE;
  const controller = new Controller(merge({ isStandalone: IS_STANDALONE }, config.rovers.lsk));
  controller.init().then(() => {
    globalLog.info('Controller init finished successfully');
  });
};

main();