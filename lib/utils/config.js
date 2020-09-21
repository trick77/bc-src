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

const parseBoolean = exports.parseBoolean = raw => {
  if (raw === 'true' || raw === '1') {
    return true;
  }

  return false;
};