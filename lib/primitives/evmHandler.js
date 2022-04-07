'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.EvmHandler = exports.setupVM = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; /**
                                                                                                                                                                                                                                                                   * Copyright (c) 2017-present, overline.network developers, All rights reserved.
                                                                                                                                                                                                                                                                   *
                                                                                                                                                                                                                                                                   * This source code is licensed under the MIT license found in the
                                                                                                                                                                                                                                                                   * LICENSE file in the root directory of this source tree.
                                                                                                                                                                                                                                                                   *
                                                                                                                                                                                                                                                                   * 
                                                                                                                                                                                                                                                                   */


var _vm = require('@ethereumjs/vm');

var _vm2 = _interopRequireDefault(_vm);

var _common = require('@ethereumjs/common');

var _common2 = _interopRequireDefault(_common);

var _tx = require('@ethereumjs/tx');

var _blockchain = require('@ethereumjs/blockchain');

var _blockchain2 = _interopRequireDefault(_blockchain);

var _block = require('@ethereumjs/block');

var _logger = require('../logger');

var _bc_pb = require('@overline/proto/proto/bc_pb');

var _index = require('../script/index');

var _index2 = _interopRequireDefault(_index);

var _txUtils = require('../core/txUtils');

var _bytecode = require('bcjs/dist/script/bytecode');

var _decimal = require('decimal.js');

var _wallet = require('../bc/wallet');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// https://github.com/ethereumjs/ethereumjs-monorepo/blob/053a3a178d76d1123e5bd2994115fc8cea26e977/packages/vm/tests/api/buildBlock.spec.ts#L29
// https://github.com/ethereumjs/ethereumjs-monorepo/blob/bffbc0385d0aef62097fd1bffeb9abdecdaa344d/packages/vm/tests/api/runTx.spec.ts
const { calcTxFee } = require('bcjs/dist/transaction');
const { Account, Address, toBuffer, BN } = require('ethereumjs-util');
const LRUCache = require('lru-cache');
const { inspect } = require('util');
const { getScriptType, ScriptType } = require('bcjs/dist/script/templates');

const {
  internalToHuman,
  CurrencyConverter,
  CurrencyInfo,
  COIN_FRACS: { NRG }
} = require('../core/coin');
const debugFactory = require('debug');
const debug = debugFactory('bcnode:primitives:feedHandler');

const setupVM = exports.setupVM = (db, opts = {}) => {
  const { common, genesisBlock } = opts;
  if (!opts.blockchain) {
    opts.blockchain = new _blockchain2.default({
      db,
      validateBlocks: false,
      validateConsensus: false,
      common,
      genesisBlock
    });
  }
  return new _vm2.default(_extends({}, opts));
};

const createBlock = (parent, n = 0, opts = {}) => {
  if (!parent) {
    return _block.Block.genesis(undefined, opts);
  }

  const blockData = {
    header: {
      number: n,
      parentHash: parent.hash(),
      difficulty: new BN(0xfffffff),
      stateRoot: parent.header.stateRoot
    }
  };
  return _block.Block.fromBlockData(blockData, opts);
};

class EvmHandler {

  constructor(persistence, txPendingPool, utxoManager, wallet, pubsub) {
    this._logger = (0, _logger.getLogger)(__filename);
    this._persistence = persistence;
    this._txPendingPool = txPendingPool;
    this._utxoManager = utxoManager;
    this._wallet = wallet;
    this._pubsub = pubsub;
    this._interpreter = new _index2.default(this._persistence, this._utxoManager);

    // setup the VM

    this._knownScriptsCache = new LRUCache({
      max: 10000
    });
  }

  // Used only once to setup the initial VM
  async init() {}

  async processTx(tx) {

    // //commenting out this function for now
    // //extract address
    const hash = tx.getHash();
    const inputs = tx.getInputsList();
    const outputs = tx.getOutputsList();
    this._logger.info(`script from address: ${hash}, inputs: ${inputs.length}, outputs: ${outputs.length}`);

    this._pubsub.publish('tx.evm.update', {
      type: 'tx.evm.update',
      data: hash
    });
  }

  async isEvmTx(tx) {

    try {
      const id = tx.getHash();
      if (this._knownScriptsCache.has(id)) {
        debug(`evm script already known ${id}`);
        return;
      }
      const outputs = tx.getOutputsList();
      const outputScript = (0, _bytecode.toASM)(Buffer.from(outputs[0].getOutputScript()), 0x01);
      debug(`check feed script ${outputScript}`);
      if (outputScript.indexOf('OP_X 0x02') > -1) {
        this._knownScriptsCache.set(id, true);
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

}
exports.EvmHandler = EvmHandler;