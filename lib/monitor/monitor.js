'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const os = require('os');

const logging = require('../logger');

// Print monitor info once per five minutes
const MONITOR_INTERVAL = 5 * 60 * 1000;

class Monitor {
  // eslint-disable-line no-undef

  constructor(engine, opts) {
    this._logger = logging.getLogger(__filename);
    this._engine = engine;
    this._opts = opts;
  }

  start() {
    this._logger.debug('Starting monitor');

    if (this._interval) {
      this.stop();
    }

    this._interval = setInterval(() => {
      this._printStats();
    }, MONITOR_INTERVAL);
  }

  stop() {
    if (!this._interval) {
      return;
    }

    this._logger.debug('Stopping monitor');
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  _printStats() {
    const stats = {
      mem: os.freemem(),
      load: os.loadavg()
    };

    this._logger.info(`Stats: ${JSON.stringify(stats, null, 2)}`);
  }
}

exports.Monitor = Monitor;
exports.default = Monitor;