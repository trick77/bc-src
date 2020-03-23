'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = help;


const { HelpResponse } = require('../../../protos/bc_pb'); /**
                                                            * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                            *
                                                            * This source code is licensed under the MIT license found in the
                                                            * LICENSE file in the root directory of this source tree.
                                                            *
                                                            * 
                                                            */

function help(context, call, callback) {
  const reply = new HelpResponse(['Hi there!']);
  callback(null, reply);
}