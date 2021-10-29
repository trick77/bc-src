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

// $FlowFixMe
const native = require('../../native/index.node');

const { MinerRequest, MinerResponse } = require('@overline/proto/proto/miner_pb');

class MinerNative {
  mine(request) {
    const buf = request.serializeBinary();
    const raw = native.mine(buf);
    return MinerResponse.deserializeBinary(new Uint8Array(raw));
  }
}
exports.default = MinerNative;