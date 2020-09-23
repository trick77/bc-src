'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getPrivateKey = getPrivateKey;
exports.randomInt = randomInt;
exports.getIntervalDifficulty = getIntervalDifficulty;
exports.writeSafely = writeSafely;
exports.shuffle = shuffle;
exports.getBacksyncEpoch = getBacksyncEpoch;
exports.semaphoreSwitch = semaphoreSwitch;
exports.batchProcess = batchProcess;
/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const crypto = require('crypto');
const fs = require('fs');
const BN = require('bn.js');
const { Writable } = require('stream');
const { concat, head, last, range, splitEvery } = require('ramda');

const debug = require('debug');

const { getLogger } = require('../logger');

/**
 * Generate private key using random bytes
 */
function getPrivateKey(length = 32) {
  return crypto.randomBytes(length);
}

// TODO: Move to config/config.json
const ROVER_SECONDS_PER_BLOCK = exports.ROVER_SECONDS_PER_BLOCK = {
  'bc': 6.0,
  'btc': 600.0,
  'eth': 15.0,
  'lsk': 10.0,
  'neo': 15.0,
  'wav': 65.0 // measured on blocks 1352650 - 1352150


  // TODO: Move to config/config.json
};const ROVER_CONFIRMATIONS = exports.ROVER_CONFIRMATIONS = {
  'btc': 2,
  'bc': 8,
  'eth': 5,
  'lsk': 15,
  'neo': 15,
  'wav': 15

  // TODO: Move to config/config.json
};const ROVER_DF_SHIFT_SECONDS = exports.ROVER_DF_SHIFT_SECONDS = {
  'neo': 300,
  'wav': 300

  //export const ROVER_RESYNC_PERIOD = Math.floor(0.3 * 60 * 60)
};const ROVER_RESYNC_PERIOD = exports.ROVER_RESYNC_PERIOD = Math.floor(0.2 * 60 * 60);

function randomInt(low, high) {
  return Math.floor(Math.random() * (high - low) + low);
}

function getIntervalDifficulty(block) {
  return new BN(block.header.difficulty).div(new BN(block.header.number)).toNumber();
}

function writeSafely(debugName) {
  const d = debug(debugName);

  return function (stream, block) {
    // readable.push(block)
    d(`Piping block ${block.getBlockchain()}:${block.getHeight()} to main process`);
    return stream.write(block);
  };
}

class StandaloneDummyStream extends Writable {

  constructor(loggerName) {
    super();
    this._logger = getLogger(loggerName);
    this._logger._prefix = `${this._logger._prefix.trim()}.dummyBlockStream `;
  }

  _write(chunk, encoding, done) {
    this._logger.info(`Would send block: ${chunk.toObject()}`);
    done();
    return true;
  }
}

exports.StandaloneDummyStream = StandaloneDummyStream;
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Return the LOCAL epoch minus the ROVER RESYNC PERIOD adjusted by rover
 */
function getBacksyncEpoch(rover) {
  if (!rover) throw Error('rover string required');
  let shift = 0;
  if (ROVER_DF_SHIFT_SECONDS[rover]) {
    shift = ROVER_DF_SHIFT_SECONDS[rover];
  }
  const initialWeight = Number(ROVER_SECONDS_PER_BLOCK[rover.toLowerCase()]) * 100000 - shift;
  return Math.floor(Date.now() * 0.001) - ROVER_RESYNC_PERIOD - initialWeight - 86400;
}

// TODO: migrate this function to redis
function semaphoreSwitch(fileName, rate = 1) {
  return new Promise((resolve, reject) => {
    // rate = 1 run once every second
    // rate = 2 run once every 500 milliseconds
    // rate = 5 run once every 200 milliseconds
    // rate = 10 run once every 100 milliseconds
    const key = fileName || 'lock';
    const fileRef = '.semaphore.' + key;
    try {
      const now = Math.floor(Date.now() * (0.001 * rate));
      let file = false;
      try {
        file = fs.readFileSync(fileRef, 'utf8');
        file = Number(file);
      } catch (_) {
        fs.writeFileSync(fileRef, now.toString(10), 'utf8');
        file = now - 1;
      }
      if (now > file) {
        return resolve(true);
      }
      return resolve(false);
    } catch (err) {
      return reject(err);
    }
  });
}

const capIntervalsToLength = exports.capIntervalsToLength = function (intervals, maxIntervalLength) {
  let resultIntervals = [];
  for (let [from, to] of intervals) {
    if (to - from <= maxIntervalLength) {
      resultIntervals.push([from, to]);
      continue;
    }

    const fullIntervals = splitEvery(maxIntervalLength, range(from, to + 1)).map(fullInterval => {
      const h = head(fullInterval);
      let t = last(fullInterval);

      return h < t ? [h, t] : [h, t + 1];
    });

    resultIntervals = concat(resultIntervals, fullIntervals);
  }
  return resultIntervals;
};

function wait(timeout) {
  return new Promise(resolve => setTimeout(resolve, timeout));
}

async function batchProcess(count, items, pause) {
  const chunked = splitEvery(count, items);
  const d = debug('bcnode:utils:batchProcess');

  const process = async function ([head, ...tail]) {
    const promises = head.map(func => func());

    d('starting to process batch');
    const results = await Promise.all(promises);
    d('batch finished');

    if (!tail.length) {
      d('nothing else to process, returning results %O', results);
      return results;
    }

    if (pause) {
      d('waiting for %o ms', pause);
      await wait(pause);
    }

    d('running next batch');
    return [...results, ...(await process(tail))];
  };

  return process(chunked);
}