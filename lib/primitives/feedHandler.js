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
const convert = (from, to) => str => Buffer.from(str, from).toString(to);
const utf8ToHex = convert('utf8', 'hex');
const hexToUtf8 = convert('hex', 'utf8');

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

  sanitizeText(text) {}

  // the first 5 bytes of the message are the encryption type, schema and the seperator
  // an unecrypted message "0" of schema "01" with the seperator "00" would be
  // "00100somerandom text"
  parseMessage(txHash, index, msg) {

    // get hash tags
    // parse out vanity for @
    // parse out reply to
    // parse out nft emotes
    // parse out referenced nfts
    // parse out id

    // message has no value
    if (!msg || msg.length < 6) {
      return false;
    }

    /////////////////////////////////////////////////
    // SCHEMA 01 // default chat
    // SCHEMA 02 // encoded media (photo, video)
    // SCHEMA 03 // encoded file // use with encryption only
    // SCHEMA 04 // oLand NFT broadcast
    // SCHEMA 05 // oRegion NFT broadcast
    ////////////////////////////////////////////////

    // decode the message body
    msg = hexToUtf8(msg.slice(2, msg.length + 1));
    // DEFAULT Canonical Decomposition, followed by Canonical Composition.
    msg = msg.normalize("NFC");

    const obj = {};
    obj.id = txHash + index;
    obj.encryptionType = msg[0]; // 0 = 'not encrypted'
    obj.schema = msg.slice(1, 3);
    obj.seperator = msg.slice(3, 5);
    obj.nfts = [];
    obj.hashTags = [];
    obj.mentions = [];
    obj.body = "";

    const parts = msg.slice(5, msg.length).split(obj.seperator);

    if (obj.encryptionType !== '0') {
      const to = parts.shift();
      obj.to = to;
      obj.body = parts.join(obj.seperator);
      return obj;
    }

    if (obj.schema === '01') {
      // SCHEMA 01
      // encryptionType + schema + seperator + nfts + body
      // there are three dynamic parts
      // 1. replyTo
      // 2. nfts of address
      // 3. body
      // replyTo optional reference to the id of another message (txHash  + id)
      const replyTo = parts[0];
      // nfts comma seperated nft list
      obj.nfts = parts[1].split(",").map(a => a.toLowerCase()).slice(0, 11).filter(a => {
        if (a.length > 1) {
          return a;
        }
      });

      if (obj.nfts[0] === "") {
        obj.nfts = [];
      }

      obj.body = parts[2];
      const hashTags = obj.body.match(/#[\p{L}]+/ugi) ? obj.body.match(/#[\p{L}]+/ugi) : [];
      const mentions = obj.body.match(/@[\p{L}]+/ugi) ? obj.body.match(/@[\p{L}]+/ugi) : [];

      obj.hashTags = hashTags.map(tag => tag.toLowerCase());
      obj.mentions = mentions.map(mention => mention.toLowerCase());
      return obj;
    } else {
      // not supported
      return false;
    }
  }

  async processTx(address, tx) {

    // //commenting out this function for now
    // //extract address
    try {

      const hash = tx.getHash();
      const inputs = tx.getInputsList();
      const outputs = tx.getOutputsList();
      this._logger.info(`message from address: ${hash}, inputs: ${inputs.length}, outputs: ${outputs.length}`);
      // //extract message
      const ol = (await this._wallet.getBalanceData(address)).confirmed;
      const emb = (await this._persistence.getMarkedBalanceData(address)).toString();
      this._logger.info(`message $OL balance: ${ol}, message $EMB balance: ${emb}`);
      const olBalance = new _bc_pb.FeedBalance();
      olBalance.setName('ol');
      olBalance.setAmount(ol);
      const embBalance = new _bc_pb.FeedBalance();
      embBalance.setName('emb');
      embBalance.setAmount(emb);

      let balances = [olBalance, embBalance];
      const possibleMessages = [];
      for (const output of outputs) {
        const outputScript = (0, _bytecode.toASM)(Buffer.from(output.getOutputScript()), 0x01);
        if (outputScript.indexOf('OP_X 0x06 0x00 0x00') > -1) {
          const hex = outputScript.split(" ").slice(6, 100).shift();
          possibleMessages.push(hex);
        }
      }

      // reply to
      // check if public nfts are there
      // parse version
      // to address
      // 0 = not, not 0 is encryption used
      // emoticon nfts
      // check signature
      // dm

      let index = 0;
      for (const msg of possibleMessages) {

        const parsedMessage = this.parseMessage(hash, index, msg);

        if (parsedMessage) {
          //// //build message object
          console.log(parsedMessage);
          balances = balances.concat(parsedMessage.nfts.map(n => {
            const f = new _bc_pb.FeedBalance();
            f.setName(n);
            f.setAmount(1);
            return f;
          }));
          const message = new _bc_pb.FeedMessage();
          message.setAddress(address);
          message.setMessage(parsedMessage.body);
          message.setTimestamp(Date.now());
          message.setBalancesList(balances); // the ol, emb, and nfts

          //// //pass to txPendingPool
          this._txPendingPool.addNewEphemeralMessage(message);
          index++;

          console.log(message);

          this._pubsub.publish('update.feed.message', message);
        }
      }
    } catch (e) {
      this._logger.error(e);
    }
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