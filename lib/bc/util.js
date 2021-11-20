'use strict';

const BN = require('bn.js'); /**
                              * Copyright (c) 2017-present, Overline developers, All rights reserved.
                              *
                              * This source code is licensed under the MIT license found in the
                              * LICENSE file in the root directory of this source tree.
                              *
                              * 
                              */

const { concat } = require('ramda');

function getDetailsFromMtx(mTx) {
  const to = mTx.getAddrTo();
  const from = mTx.getAddrFrom();
  const chain = mTx.getId();
  const amount = new BN(mTx.getValue());
  const height = mTx.getBlockHeight();
  const hash = mTx.getHash();
  const tokenType = mTx.getToken();
  return { to, from, chain, amount, height, hash, tokenType };
}

function getAllMarkedTxs(blockUp) {
  const headersMap = blockUp.getBlockchainHeaders();
  let markedTxs = [];
  let methodNames = Object.keys(headersMap.toObject());
  for (let i = 0; i < methodNames.length; i++) {
    let rover = methodNames[i];
    const getMethodName = `get${rover[0].toUpperCase()}${rover.slice(1)}`;
    const childBlocks = headersMap[getMethodName]();
    for (let j = 0; j < childBlocks.length; j++) {
      let cb = childBlocks[j];
      if (cb) {
        let marked = cb.getMarkedTxsList().map(mTx => {
          let obj = getDetailsFromMtx(mTx);
          obj.childHash = cb.getHash();
          return obj;
        });
        markedTxs = concat(markedTxs, marked);
      }
    }
  }
  return markedTxs;
}

module.exports = { getAllMarkedTxs, getDetailsFromMtx };