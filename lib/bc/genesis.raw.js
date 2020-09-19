'use strict';

// this file is intentionaly named es6 to be copied to the resulting lib folder
// if named .json babel will not pick it up during transpilation
// hash is created from blake2bl(miner+merkleRoot+fingerprintsroot+emblemchainFingerpritnroot+difficulty)
module.exports = {
  'hash': 'a8212d5a65f579c2018b19172be34e4422a93c8437f8e7c19ddc8cad15353862',
  'previousHash': 'b6615809ca3ff24562ce2724ef010e369a976cb9068570074f88919eaddcd08f',
  'version': 1,
  'schemaVersion': 1,
  'height': 1,
  'miner': '0x028d3af888e08aa8380e5866b6ed068bd60e7b19',
  'difficulty': '296401962029366',
  'timestamp': 0,
  'merkleRoot': 'b277537249649f9e7e56d549805ccfdec56fddd6153c6bf4ded85c3e072ccbdf',
  'chainRoot': 'b4816d65eabac8f1a143805ffc6f4ca148c4548e020de3db21207a4849ea9abe',
  'distance': 15698005660040,
  'totalDistance': '15698005660040',
  'nonce': 'bf03cdfbc60f2d075a3dadf27e5a372b64cbaea4c20923048dfd8c431408c332',
  'nrgGrant': 200000000,
  'twn': 0, // Overline
  'twsList': [], // Overline

  'emblemWeight': 6757,
  'emblemChainFingerprintRoot': '87b2bc3f12e3ded808c6d4b9b528381fa2a7e95ff2368ba93191a9495daa7f50',
  'emblemChainAddress': '0x28b94f58b11ac945341329dbf2e5ef7f8bd44225',

  'txCount': 0,
  'txFeeBase': 0,
  'txDistanceSumLimit': 0,

  'childBlockchainCount': 5, // not used in genesis module now
  'blockchainHeadersMap': {},

  'blockchainFingerprintsRoot': 'd65ffda8a561b53c09377ef7d3ee9ebbf18a618c603faf2631c1bbb7d66a03ac',
  'ATBalanceDigest': '91199a150de07009d537b4b8191c67d81c657e0df96062e46ecd05ab5d4480ae489e57f397739a6a897889bc68a96c78096f4044cb63e8c274cbb43b853faab7'
};