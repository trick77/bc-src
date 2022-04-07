'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});


const { BcBlocks } = require('@overline/proto/proto/p2p_pb');
//const {BcBlocks,BcMessages} = require('@overline/proto/proto/p2p_pb') // stub for messaging


/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
/* global $Values */
const { intersperse, is } = require('ramda');
const debug = require('debug')('bcnode:p2p:codec');

const { MESSAGES, MSG_SEPARATOR } = require('./protocol');

const encodeTypeAndData = exports.encodeTypeAndData = (type, data) => {
  debug(`encodeTypeAndData(), t: ${type}`);
  const sep = MSG_SEPARATOR[type];
  const prefix = Buffer.from(type + sep);
  let msg;

  const serializeData = d => {
    if (d.serializeBinary) {
      return d.serializeBinary();
    }
    return Buffer.from(JSON.stringify(d));
  };

  if (type === MESSAGES.DATA) {
    let blocks = new BcBlocks();
    blocks.setBlocksList(data);
    msg = serializeData(blocks);
  } else if (type === MESSAGES.FEED) {
    //let messages = new BcMessages()
    //messages.setMessagesList(data)
    //msg = serializeData(messages)
  } else if (is(Array, data)) {
    // creates array in shape of [msg[1].binary, sep, msg[2].binary, sep, ...]
    msg = Buffer.concat(intersperse(Buffer.from(sep), data.map(m => serializeData(m))));
  } else {
    msg = serializeData(data);
  }

  debug(`encodeTypeAndData(), dlength: ${prefix.length + msg.length}`);

  return Buffer.concat([prefix, msg]);
};

const encodeMessageToWire = exports.encodeMessageToWire = data => {
  const msgHeader = Buffer.allocUnsafe(4);
  msgHeader.writeUInt32BE(data.length, 0);

  return Buffer.concat([msgHeader, data]);
};