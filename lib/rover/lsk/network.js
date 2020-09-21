'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

const { merge } = require('ramda'); /**
                                     * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
                                     *
                                     * This source code is licensed under the MIT license found in the
                                     * LICENSE file in the root directory of this source tree.
                                     *
                                     * 
                                     */

const logging = require('../../logger');
const DEFAULT_STATE = {};

// XXX this is intentionally left almost blank - module exists just for
// keeping the structure same for all rovers - lisk asks api and does not need network module
class Network {
  // eslint-disable-line no-undef

  // TODO extract btc/Network common functionality to super class
  constructor(config = {}) {
    this._logger = logging.getLogger(__filename);
    this._state = merge(DEFAULT_STATE, config);
  } // eslint-disable-line no-undef
}
exports.default = Network;