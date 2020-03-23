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
const avon = require('avon');
const toBuffer = require('to-buffer');

/**
 * Calculates blake2b hash
 *
 * @param input - string to be hashed
 * @returns {String} hash
 */
const blake2b = exports.blake2b = input => {
  return avon.sumBuffer(toBuffer(input), avon.ALGORITHMS.B).toString('hex');
};

/**
 * Calculates blake2bl hash
 *
 * @param input - string to be hashed
 * @returns {String} hash
 */
const blake2bl = exports.blake2bl = input => {
  return blake2b(input).slice(64, 128);
};

/**
 * Calculates blake2bls hash
 *
 * @param input - string to be hashed
 * @returns {String} hash
 */
const blake2bls = exports.blake2bls = input => {
  return blake2b(input).slice(88, 128);
};

/**
 * Calculates blake2blc hash
 *
 * @param input - compressed address blake
 * @returns {String} hash
 */
const blake2blc = exports.blake2blc = input => {
  const preimage = blake2bl(input);
  const compressed = blake2bls(preimage);
  return compressed;
};