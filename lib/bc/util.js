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
  const index = !mTx.getIndex || !mTx.getIndex() ? "" : mTx.getIndex();
  return { to, from, chain, amount, height, hash, tokenType, index };
}

function getChildMarkedTxs(cb) {
  let list = cb.getMarkedTxsList();
  // slice out the marked NFT chat txs
  if (cb.getBlockchain && cb.getBlockchain() === 'eth' && cb.getHeight() < 14507240) {
    if (list.length != cb.getMarkedTxCount()) {
      list = list.slice(0, cb.getMarkedTxCount());
    }
  }
  return list.map(mTx => {
    let obj = getDetailsFromMtx(mTx);
    obj.childHash = cb.getHash();
    return obj;
  });
}

function getChildTouchedMarkedTxs(cb) {
  let list = cb.getMarkedTxsList();
  if (list.length != cb.getMarkedTxCount()) {
    list = list.slice(cb.getMarkedTxCount(), list.length + 1);
  }
  return list.map(mTx => {
    let obj = getDetailsFromMtx(mTx);
    obj.childHash = cb.getHash();
    return obj;
  });
}

function getAllTouchedMarkedTxs(blockUp) {

  let markedTxs = [];

  if (blockUp.getBlockchain) {
    return concat(markedTxs, getChildTouchedMarkedTxs(blockUp));
  }

  const headersMap = blockUp.getBlockchainHeaders();
  let methodNames = Object.keys(headersMap.toObject());
  for (let i = 0; i < methodNames.length; i++) {
    let rover = methodNames[i];
    const getMethodName = `get${rover[0].toUpperCase()}${rover.slice(1)}`;
    const childBlocks = headersMap[getMethodName]();
    for (let j = 0; j < childBlocks.length; j++) {
      let cb = childBlocks[j];
      if (cb) {
        markedTxs = concat(markedTxs, getChildTouchedMarkedTxs(cb));
      }
    }
  }
  return markedTxs;
}

function getAllMarkedTxs(blockUp) {

  let markedTxs = [];

  if (blockUp.getBlockchain) {
    return concat(markedTxs, getChildMarkedTxs(blockUp));
  }

  const headersMap = blockUp.getBlockchainHeaders();
  let methodNames = Object.keys(headersMap.toObject());
  for (let i = 0; i < methodNames.length; i++) {
    let rover = methodNames[i];
    const getMethodName = `get${rover[0].toUpperCase()}${rover.slice(1)}`;
    const childBlocks = headersMap[getMethodName]();
    for (let j = 0; j < childBlocks.length; j++) {
      let cb = childBlocks[j];
      if (cb) {
        markedTxs = concat(markedTxs, getChildMarkedTxs(cb));
      }
    }
  }
  return markedTxs;
}

module.exports = { getAllMarkedTxs, getDetailsFromMtx, getAllTouchedMarkedTxs };