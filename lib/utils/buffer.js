'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/**
 * Copyright (c) 2018-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const toBuffer = require('to-buffer');

const leftPadBuffer = exports.leftPadBuffer = (maybeBuffer, length) => {
  const zeros = Buffer.allocUnsafe(length).fill(0);
  const buf = toBuffer(maybeBuffer, 'hex');

  if (buf.length < length) {
    buf.copy(zeros, length - buf.length);
    return zeros;
  }
  return buf.slice(-length);
};

const intToBuffer = exports.intToBuffer = n => {
  let hex = n.toString(16);
  if (hex.length % 2) {
    hex = `0${hex}`;
  }

  return Buffer.from(hex, 'hex');
};

const bufferToInt = exports.bufferToInt = buf => {
  return parseInt(buf.toString('hex'), 16);
};