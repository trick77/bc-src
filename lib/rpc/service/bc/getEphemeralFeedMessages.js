'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getEphemeralFeedMessages;


const { GetFeedMessagesRequest, FeedMessages } = require('@overline/proto/proto/bc_pb'); /**
                                                                                          * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                                          *
                                                                                          * This source code is licensed under the MIT license found in the
                                                                                          * LICENSE file in the root directory of this source tree.
                                                                                          *
                                                                                          * 
                                                                                          */

function getEphemeralFeedMessages(context, call, callback) {
  const req = call.request;
  const from = req.getFrom();
  const to = req.getTo();
  let msgs = context.server.engine._txPendingPool.getEphemeralFeedMessages(from, to);
  let repl = new FeedMessages();
  FeedMessages.setMessagesList(msgs);
  callback(null, msgs);
}