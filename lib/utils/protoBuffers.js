'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/*
 * Copyright (c) 2017-present, Block Collider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const BN = require('bn.js');
const { groupWith } = require('ramda');

const { BlockHeader, Block, BcBlock } = require('../protos/core_pb');


/**
 * Sorts protobuf with getHeight method in specified order
 *
 * desc = from highest to lowest by height
 * asc = from lowest to highest by height
 */
const sortBlocks = exports.sortBlocks = (list, order) => {
  return list.sort((a, b) => {
    if (new BN(a.getHeight()).gt(new BN(b.getHeight())) === true) {
      return order === 'desc' ? -1 : 1;
    }
    if (new BN(a.getHeight()).lt(new BN(b.getHeight())) === true) {
      return order === 'desc' ? 1 : -1;
    }
    return 0;
  });
};

const toMissingIntervals = exports.toMissingIntervals = blockNumbers => groupWith((a, b) => a - 1 === b, blockNumbers).map(arr => [arr[0], arr[arr.length - 1]]);