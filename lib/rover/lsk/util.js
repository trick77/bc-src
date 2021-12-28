'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FetchIntervalStore = exports.IntervalLimit = undefined;

var _util = require('util');

var _crypto = require('crypto');

var _ramda = require('ramda');

var _logger = require('../../logger');

class IntervalLimit {

  constructor(height, hash) {
    this.height = height;
    this.hash = hash;
  }
}

exports.IntervalLimit = IntervalLimit; // This likely has to be a queue of queues, becaus of the multiple intervals

// TODO it is crucial that the intervals do not overlap or are not continous
// because of the hash based block fetching, check for that!
/**
 * Copyright (c) 2017-present, Overline developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

class FetchIntervalStore {
  // always [highest, lowest][]

  constructor() {
    this._logger = (0, _logger.getLogger)(`rover.lsk.fetch_interval_store.${(0, _crypto.randomBytes)(3).toString('hex')}`, false);
    this._currentlySeekingHeights = null;
    this._currentlySeekingInterval = null;
    this._intervals = [];
  }

  // both from and to are inclusive
  // always [highest, lowest]
  saveInterval(highest, lowest) {
    this._logger.debug('saveInterval(): highest = %o, lowest = %o', highest, lowest);
    // TODO check maximum of 103 blocks
    let range = [highest, lowest];
    // TODO this method should check for duplicates ?and overlaps?

    this._intervals.push(range);
    // if (this._intervals.length > 0) {
    //   let [prevHigh, prevLow] = this._intervals[0]
    //   if (prevHigh.height < highest.height || prevLow.height > lowest.height) {
    //     // FIXME find out why clearing
    //     this._intervals = []
    //     this._intervals.push(range)
    //   }
    // } else {
    //   this._intervals.push(range)
    // }
  }

  hasHeight(height) {
    for (let [highest, lowest] of this._intervals) {
      if (lowest.height <= height && height <= highest.height) {
        return true;
      }
    }

    return false;
  }

  hasRange() {
    return this._intervals.length > 0;
  }

  nextRange(lowestHash) {
    if (this.hasRange()) {
      const [highest, lowest] = this._intervals.pop();
      if (!lowest.hash && lowestHash) {
        lowest.hash = lowestHash;
      }
      const next = [highest, lowest];
      this._currentlySeekingInterval = next;
      return next;
    }

    throw new Error('No range available');
  }

  // in case of LSK here we are saying we have lowest block
  setCurrentlySeekingBlocks(highest, lowest) {
    this._currentlySeekingHeights = (0, _ramda.range)(lowest.height + 1, highest.height);
    this._currentlySeekingHeights.reverse();
  }

  foundBlock(height) {
    const currentSeek = this._currentlySeekingHeights && Array.isArray(this._currentlySeekingHeights) ? this._currentlySeekingHeights.includes(height) : false;
    this._logger.debug('foundBlock(): height = %d, isArray = %o, includes = %o', height, Array.isArray(this._currentlySeekingHeights), currentSeek);
    if (currentSeek) {
      this._currentlySeekingHeights.splice(this._currentlySeekingHeights.indexOf(height), 1);
      this._logger.debug('foundBlock(): removed = %d', height);
    }
    if (currentSeek && this._currentlySeekingHeights.length === 0) {
      this._currentlySeekingHeights = null;
    }
    this._logger.debug('foundBlock(): _currentlySeekingHeights = %o', this._currentlySeekingHeights);
  }

  isSeekingBlocks() {
    return this._currentlySeekingHeights !== null;
  }

  getFinishedInterval(highestHash) {
    if (this.isSeekingBlocks() || this._currentlySeekingInterval === null || this._currentlySeekingInterval === undefined) {
      const errMessage = (0, _util.format)('Cannot mark interval %o as finised, currently seeking blocks = %o', this._currentlySeekingInterval, this._currentlySeekingHeights);
      throw new Error(errMessage);
    }

    const [highest, lowest] = this._currentlySeekingInterval;
    if (!highest.hash && highestHash) {
      highest.hash = highestHash;
    }
    const finishedInterval = [highest, lowest];
    this._currentlySeekingInterval = null;
    return finishedInterval;
  }
}
exports.FetchIntervalStore = FetchIntervalStore;