'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FeedHandler = undefined;

var _bn = require('bn.js');

var _bn2 = _interopRequireDefault(_bn);

var _logger = require('../logger');

var _core_pb = require('@overline/proto/proto/core_pb');

var _bc_pb = require('@overline/proto/proto/bc_pb');

var _index = require('../script/index');

var _index2 = _interopRequireDefault(_index);

var _txUtils = require('../core/txUtils');

var _bytecode = require('bcjs/dist/script/bytecode');

var _decimal = require('decimal.js');

var _wallet = require('../bc/wallet');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const { calcTxFee } = require('bcjs/dist/transaction'); /**
                                                         * Copyright (c) 2017-present, overline.network developers, All rights reserved.
                                                         *
                                                         * This source code is licensed under the MIT license found in the
                                                         * LICENSE file in the root directory of this source tree.
                                                         *
                                                         * 
                                                         */


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

class FeedHandler {

  constructor(persistence, txPendingPool, utxoManager, wallet, pubsub) {
    this._logger = (0, _logger.getLogger)(__filename);
    this._persistence = persistence;
    this._txPendingPool = txPendingPool;
    this._utxoManager = utxoManager;
    this._wallet = wallet;
    this._pubsub = pubsub;
    this._interpreter = new _index2.default(this._persistence, this._utxoManager);

    this._knownFeedsCache = new LRUCache({
      max: 10000
    });

    this._feedBalancesCache = new LRUCache({
      max: 2000
    });
  }

  async processTx(tx) {

    // //commenting out this function for now
    // //extract address
    const hash = tx.getHash();
    const inputs = tx.getInputsList();
    const outputs = tx.getOutputsList();
    this._logger.info(`message from address: ${hash}, inputs: ${inputs.length}, outputs: ${outputs.length}`);
    this._logger.info(`${Object.keys(outputs[0])}`);
    this._logger.info(`${Object.keys(outputs[0])}`);
    // //extract message
    //const ol = (await this._wallet.getBalanceData(address)).confirmed;
    //const emb = (await this._persistence.getMarkedBalanceData(address)).toString();
    //this._logger.info(`message $OL balance: ${ol}, message $EMB balance: ${emb}`)
    //const olBalance = new FeedBalance();
    //olBalance.setName('ol');
    //olBalance.setAmount(ol);
    //const embBalance = new FeedBalance();
    //embBalance.setName('emb');
    //embBalance.setAmount(emb);

    //const balances = [olBalance,embBalance]

    //// //build message object
    //const message = new FeedMessage();
    //message.setAddress(address);
    //message.setMessage(script);
    //message.setTimestamp(Date.now());
    //message.setFeedBalanceList(balances)
    //// //pass to txPendingPool
    //this._txPendingPool.addNewEphemeralMessage(message)

    this._pubsub.publish('tx.feed.message.update', {
      type: 'tx.feed.message.update',
      data: message
    });
  }

  async isFeedTx(tx) {

    try {
      const id = tx.getHash();
      if (this._knownFeedsCache.has(id)) {
        debug(`message already known ${id}`);
        return;
      }
      const outputs = tx.getOutputsList();
      const outputScript = (0, _bytecode.toASM)(Buffer.from(outputs[0].getOutputScript()), 0x01);
      debug(`check feed script ${outputScript}`);
      if (outputScript.indexOf('OP_X 0x06') > -1) {
        this._knownFeedsCache.set(id, true);
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

}
exports.FeedHandler = FeedHandler;