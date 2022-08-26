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

// loads the correct difficulty test for a given block
function getBlockSchema(block) {

  if (!block) {
    throw new Error('getBlockMiningSchema(): block is required');
  }

  const schema = block.getSchemaVersion();
  if (schema === 1) {
    // reserved for OL
    return 1;
  }

  if (schema === 2) {
    // multimining schema
    if (block.getTwn() !== 0 && // there must be listed tethered work
    block.getTwn() <= 3 && // no more than 3 tethered work claims can be made
    block.getTwsList().length === block.getTwn()) {
      // number of tethered work claimed must match number of tethered work shares

      // the block must submit work
      let foundTetherWork = false;
      let foundTetherBlock = false;

      // confirm block has a valid tethered work share for each claimed work
      const headersMap = block.getBlockchainHeaders();
      let methodNames = Object.keys(headersMap.toObject());
      for (let i = 0; i < methodNames.length; i++) {
        let rover = methodNames[i];
        const getMethodName = `get${rover[0].toUpperCase()}${rover.slice(1)}`;
        const childBlocks = headersMap[getMethodName]();
      }
      // this block is submitting work based on tethered work
      return 2;
    } else {
      // this block is submitting work without tethered work and should be evaluated against a standard difficulty schema
      return 1;
    }
  }

  // default to schema 1
  return 1;
}

function getDetailsFromMtx(mTx) {
  const to = mTx.getAddrTo();
  const from = mTx.getAddrFrom();
  const chain = mTx.getId();
  const amount = new BN(mTx.getValue());
  const height = mTx.getBlockHeight();
  const hash = mTx.getHash();
  const tokenType = mTx.getToken();
  const index = !mTx.getIndex || !mTx.getIndex() ? '' : mTx.getIndex();
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

function getDifficultySchema(blockUp) {

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

module.exports = { getAllMarkedTxs, getDetailsFromMtx, getAllTouchedMarkedTxs, getBlockSchema };