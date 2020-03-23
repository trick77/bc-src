'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _coin = require('bcjs/dist/utils/coin');

Object.keys(_coin).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _coin[key];
    }
  });
});
/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const { humanToInternalAsBN } = require('bcjs/dist/utils/coin');

const humanToBN = exports.humanToBN = humanToInternalAsBN;