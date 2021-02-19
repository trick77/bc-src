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
  xaut: 'eth',
  wbtc: 'eth',
  uni: 'eth',
  wise: 'eth',
  frax: 'eth',
  ust: 'eth',
  link: 'eth',
  core: 'eth',
  dpi: 'eth',
  hez: 'eth',
  bond: 'eth',
  mkr: 'eth',
  ampl: 'eth',
  bac: 'eth',
  lon: 'eth',
  alpha: 'eth',
  sdt: 'eth',
  duck: 'eth',
  pols: 'eth',
  exrd: 'eth',
  tusd: 'eth',
  lrc: 'eth',
  ddim: 'eth',
  cel: 'eth',
  cc10: 'eth',
  crv: 'eth',
  tru: 'eth',
  xor: 'eth',
  yfi: 'eth',
  snx: 'eth',
  rook: 'eth',
  pbtc35a: 'eth',
  pickle: 'eth',
  farm: 'eth',
  combo: 'eth',
  orn: 'eth',
  perp: 'eth',
  ankreth: 'eth',
  fnk: 'eth',
  ren: 'eth',
  onx: 'eth',
  apy: 'eth',
  comp: 'eth',
  bao: 'eth',
  omg: 'eth',
  yfdai: 'eth',
  stake: 'eth',
  ramp: 'eth',
  sand: 'eth',
  keep: 'eth',
  mph: 'eth',
  renbtc: 'eth'
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