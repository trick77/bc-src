'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const MESSAGES = exports.MESSAGES = {
  HANDSHAKE: '0000R01',
  GET_BLOCKS: '0006R01',
  BLOCKS: '0007W01',
  GET_BLOCK: '0008R01',
  BLOCK: '0008W01',
  GET_MULTIVERSE: '0009R01',
  MULTIVERSE: '0010W01',
  GET_SOLUTION: '0011W01',
  SOLUTION: '0012W01',
  GET_TXS: '0013R01',
  TX: '0014W01',
  TXS: '0015W01',
  GET_HEADER: '0016R01',
  HEADER: '0017W01',
  GET_HEADERS: '0018R01',
  HEADERS: '0019W01',
  GET_DATA: '0020R01',
  DATA: '0021W01',
  GET_DISTANCE: '0022R01',
  DISTANCE: '0023W01',
  PUT_CONFIG: '0024W01', // OTA updates
  GET_CONFIG: '0025R01',
  CONFIG: '0026W01',
  GET_RECORD: '0027R01',
  RECORD: '0028W01'
};

const MSG_SEPARATOR = exports.MSG_SEPARATOR = {
  [MESSAGES.HANDSHAKE]: '[*]', // handshake
  '0001R01': '[*]', // reserved
  '0002W01': '[*]', // reserved
  '0003R01': '[*]', // reserved
  '0004W01': '[*]', // reserved
  '0005R01': '[*]', // list services
  [MESSAGES.GET_BLOCKS]: '[*]', // read block heights (full sync)
  [MESSAGES.BLOCKS]: '[*]', // write block heights
  [MESSAGES.GET_BLOCK]: '[*]', // read highest block
  [MESSAGES.BLOCK]: '[*]', // write highest block
  [MESSAGES.GET_MULTIVERSE]: '[*]', // read multiverse (selective sync)
  [MESSAGES.MULTIVERSE]: '[*]', // write multiverse (selective sync)
  '0011W01': '[*]', // write challenge block
  '0012W01': '[*]', // write challenge block
  [MESSAGES.GET_TXS]: '[*]', // read TXs for a block ?or by hashes?
  [MESSAGES.TX]: '[*]', // announce TX
  [MESSAGES.TXS]: '[*]', // write TXs list identified by block hash or by TX hashes list
  [MESSAGES.GET_HEADER]: '[*]', // send peer local header
  [MESSAGES.HEADER]: '[*]', // write header sent from peer
  [MESSAGES.GET_HEADERS]: '[*]', // send range of headers to peer
  [MESSAGES.HEADERS]: '[*]', // write headers sent from peer
  [MESSAGES.GET_DATA]: '[*]', // get range of data (txs, marked, connected chains) from block hashes
  [MESSAGES.DATA]: '[*]', // write range of data (txs, marked, connected chains) from block hash list
  [MESSAGES.GET_DISTANCE]: '[*]', // request send distance solution
  [MESSAGES.DISTANCE]: '[*]', // peer broadcast distance solution
  [MESSAGES.PUT_CONFIG]: '[*]', // request for local services configuration
  [MESSAGES.GET_CONFIG]: '[*]', // request for local services configuration
  [MESSAGES.CONFIG]: '[*]', // send local services configuration
  [MESSAGES.GET_RECORD]: '[*]', // request for local services configuration
  [MESSAGES.RECORD]: '[*]' // send local services configuration
};

const SERVICES = exports.SERVICES = {
  BORDERLESS_RPC: '00BRDLRPC1', // node supports borderless rpc interfacing
  AT_P2P: '00ATP2P1', // node supports the upgraded After Target P2P protocol
  OT_P2P: '00OTP2P1' // node supports the upgraded Overline P2P protocol
};