'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});


const Sntp = require('sntp'); /**
                               * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
                               *
                               * This source code is licensed under the MIT license found in the
                               * LICENSE file in the root directory of this source tree.
                               *
                               * 
                               */


const { getLogger } = require('../logger/index');

const REFRESH_INTERVAL = 10 * 60 * 1000; // 10m
const OPTIONS = { host: 'pool.ntp.org' };

class TimeService {

  constructor() {
    this._offset = 0;
    this.inFlight = false;
    this.lastSyncedAt = undefined;
    this._logger = getLogger(__filename);
  } // eslint-disable-line no-undef
  // export for tests


  ntpGetOffset() {
    this.inFlight = true;
    Sntp.time(OPTIONS, (err, { t } = { t: 0 }) => {
      this.inFlight = false;
      if (err) {
        this._offset = t << 0;
        this.inFlight = false;
        this._logger.debug(`could not get offset from NTP servers, reason ${err.message}`);
        return;
      }
      this._offset = t << 0;
      this.inFlight = false;
      this.lastSyncedAt = Date.now();
      this._logger.debug(`NTP sync successful, got offset: ${this._offset}`);
    });
  }

  start() {
    if (this.intervalHandler === undefined) {
      this._logger.debug('starting NTP time sync');
      this.ntpGetOffset();
      this.intervalHandler = setInterval(this.ntpGetOffset.bind(this), REFRESH_INTERVAL);
    }
  }

  stop() {
    this._logger.debug('stopping NTP time cycle');
    this.intervalHandler && clearInterval(this.intervalHandler);
    this.intervalHandler = undefined;
  }

  offsetOverride(offset) {
    this._logger.debug('NTP offset resolved');
    this._offset = offset;
    this.lastSyncedAt = Date.now();
  }

  get isStarted() {
    return this.intervalHandler !== undefined;
  }

  get offset() {
    return this._offset;
  }

  now() {
    if (this.lastSyncedAt === undefined) {
      this._logger.debug('TimeService did not sync at least once, either there is error while syncing or you have to start() it');
    } else if (Date.now() - (this.lastSyncedAt || 0) > REFRESH_INTERVAL * 5) {
      this._logger.debug('TimeService did not sync in last five minutes, there is an error in NTP sync');
    }
    return Date.now() + this._offset;
  }

  /**
   * @return unix timestamp in seconds
   */
  nowSeconds() {
    return this.now() / 1000 << 0;
  }

  getDate() {
    return new Date(this.now());
  }

  /**
   * Simulates moment().utc().format()
   */
  iso() {
    return new Date(this.now()).toISOString().split('.')[0] + 'Z';
  }
}

exports.TimeService = TimeService;
exports.default = new TimeService();