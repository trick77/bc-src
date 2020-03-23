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
const {
  reduce,
  concat,
  map,
  range
} = require('ramda');

const concatAll = exports.concatAll = reduce(concat, []);

const randRange = exports.randRange = (min, max) => Math.random() * (max - min + 1) + min << 0;

const rangeStep = exports.rangeStep = (start, step, stop) => {
  if (start > stop) {
    throw new Error(`${start} > ${stop}`);
  }
  return map(n => start + step * n, range(0, 1 + (stop - start) / step >>> 0));
};