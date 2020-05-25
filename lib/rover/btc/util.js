'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.extractAddressFromInput = extractAddressFromInput;
exports.extractAddressFromOutput = extractAddressFromOutput;
/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const bitcoin = require('bitcoinjs-lib');
const templatePKH = require('bitcoinjs-lib/src/templates/pubkeyhash');
const templateSH = require('bitcoinjs-lib/src/templates/scripthash');
const templateWPKH = require('bitcoinjs-lib/src/templates/witnesspubkeyhash');
const templateWSH = require('bitcoinjs-lib/src/templates/witnessscripthash');

function extractAddressFromInput(input) {
  if (templatePKH.input.check(input.script)) {
    const [signature, pubkey] = bitcoin.script.toStack(input.script);
    return bitcoin.payments.p2pkh({ signature, pubkey }).address;
  }

  if (templateSH.input.check(input.script)) {
    // TODO do the same dance as in node_modules/bitcoinjs-lib/src/templates/scripthash/input.js
    const chunks = bitcoin.script.decompile(input.script);
    const redeemScript = chunks[chunks.length - 1];
    const redeemScriptChunks = bitcoin.script.decompile(redeemScript);

    // p2sh-p2wpkh or p2sh-p2wsh (see https://bitcoincore.org/en/segwit_wallet_dev/)
    if (templateWPKH.output.check(redeemScriptChunks) || templateWSH.output.check(redeemScriptChunks)) {
      const redeemScriptHash = bitcoin.crypto.hash160(redeemScript);
      const scriptPubKey = bitcoin.script.fromASM(`OP_HASH160 ${redeemScriptHash.toString('hex')} OP_EQUAL`);
      return bitcoin.address.fromOutputScript(scriptPubKey, bitcoin.networks.bitcoin);
    }

    return bitcoin.payments.p2sh({ input: input.script, witness: input.witness }).address;
  }

  if (templateWPKH.input.check(input.witness)) {
    return bitcoin.payments.p2wpkh({ witness: input.witness }).address;
  }

  if (templateWSH.input.check(input.witness)) {
    return bitcoin.payments.p2wsh({ witness: input.witness }).address;
  }

  return null;
}

function extractAddressFromOutput(output) {
  if (output.script[0] === bitcoin.script.OPS.OP_RETURN) {
    return null;
  }
  return bitcoin.address.fromOutputScript(output.script);
}