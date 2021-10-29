'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/* eslint-disable */
// TODO: Remove ESLINT disable

/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
/* global $Values */
const { inspect } = require('util');

const Url = require('url');
const queue = require('async/queue');
const bufferSplit = require('buffer-split');

const LRUCache = require('lru-cache');
const BN = require('bn.js');
const debug = require('debug')('bcnode:p2p:node');
const framer = require('frame-stream');
const backpressureWriteStream = require('stream-write');
const logging = require('../logger');
const { BcBlock, Transaction } = require('@overline/proto/proto/core_pb');
const { parseBoolean } = require('../utils/config');
const { networks } = require('../config/networks');

const MAX_HEADER_RANGE = exports.MAX_HEADER_RANGE = Number(process.env.MAX_HEADER_RANGE) || 1000;
const BC_MAX_DATA_RANGE = exports.BC_MAX_DATA_RANGE = Number(process.env.BC_MAX_DATA_RANGE) || 200;
const BC_NETWORK = process.env.BC_NETWORK || 'main';
const { quorum, maximumWaypoints } = networks[BC_NETWORK];
const MIN_HEALTH_NET = process.env.MIN_HEALTH_NET === 'true';
const BC_USER_QUORUM = parseInt(process.env.BC_USER_QUORUM, 10) || quorum;
const BC_MAX_CONNECTIONS = process.env.BC_MAX_CONNECTIONS || maximumWaypoints;
const STRICT_SEND_BC = process.env.STRICT_SEND_BC || true;
const DISABLE_IPH_TEST = parseBoolean(process.env.DISABLE_IPH_TEST);
const BC_PEER_HEADER_SYNC_EXPIRE = 13660;
const PEER_DATA_SYNC_EXPIRE = 15661;
const _MAX_FRAME_SIZE = 16 * 1024 * 1024; // 16MB
const { contains, find, isEmpty, max, min, merge, values } = require('ramda');
const { MESSAGES, MSG_SEPARATOR } = require('../p2p/protocol');

process.on('uncaughtException', err => {
  console.trace(err); // eslint-disable-line no-console
});

class OverlineNode {
  // eslint-disable-line no-undef

  constructor(engine) {
    debug('---  CONFIG ---\n' + JSON.stringify(networks[BC_NETWORK], null, 2));
    this._engine = engine;
  }

  /**
   * Connect Interface
   */
  // eslint-disable-line no-undef
  async connectInterface() {
    // interface module from GB for local device goes here
    // it's Tron
  }
}

exports.OverlineNode = OverlineNode;
exports.default = OverlineNode;