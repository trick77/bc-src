'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getFastSyncStatus;

const { SyncStatus } = require('../../../protos/bc_pb'); /**
                                                          * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                          *
                                                          * This source code is licensed under the MIT license found in the
                                                          * LICENSE file in the root directory of this source tree.
                                                          *
                                                          * 
                                                          */

const { parseBoolean } = require('../../../utils/config');

const OL_FAST_SYNC = process.env.OL_FAST_SYNC ? parseBoolean(process.env.OL_FAST_SYNC) : false;

function getFastSyncStatus(context, call, callback) {
  let status = new SyncStatus();
  if (OL_FAST_SYNC) {
    status.setStatus('fast_sync');
    callback(null, status);
  } else {
    status.setStatus('complete');
    callback(null, status);
  }
}