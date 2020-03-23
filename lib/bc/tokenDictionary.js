'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
const tokenDictionary = exports.tokenDictionary = {
  emb: 'eth',
  nrg: 'bc',
  btc: 'btc',
  eth: 'eth',
  dai: 'eth',
  neo: 'neo',
  wav: 'wav',
  lsk: 'lsk',
  usdt: 'eth',
  xaut: 'eth'
}; /**
    * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
    *
    * This source code is licensed under the MIT license found in the
    * LICENSE file in the root directory of this source tree.
    *
    * 
    */
const getChildBlocks = exports.getChildBlocks = (bcBlock, asset) => {
  if (asset === 'nrg') {
    return [bcBlock];
  } else {
    let childChain = tokenDictionary[asset];
    childChain = `${childChain[0].toUpperCase()}${childChain.slice(1)}`;

    return bcBlock.getBlockchainHeaders()[`get${childChain}List`] ? bcBlock.getBlockchainHeaders()[`get${childChain}List`]() : [bcBlock];
  }
};