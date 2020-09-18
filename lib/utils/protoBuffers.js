'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/*
 * Copyright (c) 2017-present, Block Collider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const BN = require('bn.js');
const { groupWith } = require('ramda');
const { BlockHeader, Block, BcBlock, BcBlockRef, BlockchainHeaders, BlockchainHeaderRefs } = require('../protos/core_pb');


/**
 * Sorts protobuf with getHeight method in specified order
 *
 * desc = from highest to lowest by height
 * asc = from lowest to highest by height
 */
const sortBlocks = exports.sortBlocks = (list, order) => {
  return list.sort((a, b) => {
    if (new BN(a.getHeight()).gt(new BN(b.getHeight())) === true) {
      return order === 'desc' ? -1 : 1;
    }
    if (new BN(a.getHeight()).lt(new BN(b.getHeight())) === true) {
      return order === 'desc' ? 1 : -1;
    }
    return 0;
  });
};

/**
 * Convert a BC Block and returns a BC Block Reference
 *
 * block = BcBlock
 */
const convertBlockToBlockRef = exports.convertBlockToBlockRef = block => {

  // invalid data
  if (!block || !block.getBlockchainHeaders && !block.getBlockchainHeaderRefs) {
    throw new Error(`unable to convert malformed data to block reference`);
  }

  // already a block reference
  if (block.getBlockchainHeaderRefs) {
    return block;
  }

  // get the child chain blocks
  const blockHeadersRef = new BlockchainHeaderRefs();
  const headersMap = block.getBlockchainHeaders();
  Object.keys(headersMap.toObject()).reduce((all, listName) => {
    const getMethodName = `get${listName[0].toUpperCase()}${listName.slice(1)}`;
    const setMethodNameRef = `set${listName[0].toUpperCase()}${listName.slice(1)}Ref`;
    const chainHeaders = headersMap[getMethodName]();
    const chainHeaderRefs = chainHeaders.map(header => {
      return header.getHash();
    });
    blockHeadersRef[setMethodNameRef](chainHeaderRefs);
  });

  // create the final block reference
  const blockRef = new BcBlockRef();
  blockRef.setHash(block.getHash());
  blockRef.setPreviousHash(block.getPreviousHash());
  blockRef.setVersion(block.getVersion());
  blockRef.setSchemaVersion(block.getSchemaVersion());
  blockRef.setHeight(block.getHeight());
  blockRef.setMiner(block.getMiner());
  blockRef.setDifficulty(block.getDifficulty());
  blockRef.setTimestamp(block.getTimestamp());
  blockRef.setMerkleRoot(block.getMerkleRoot());
  blockRef.setChainRoot(block.getChainRoot());
  blockRef.setDistance(block.getDistance());
  blockRef.setTotalDistance(block.getTotalDistance());
  blockRef.setNonce(block.getNonce());
  blockRef.setNrgGrant(block.getNrgGrant());
  blockRef.setTwn(block.getTwn());
  blockRef.setTws(block.getTws());
  blockRef.setEmblemWeight(block.getEmblemWeight());
  blockRef.setEmblemChainFingerprintRoot(block.getEmblemChainFingerprintRoot());
  blockRef.setEmblemChainAddress(block.getEmblemChainAddress());
  blockRef.setTxCount(block.getTxCount());
  blockRef.setTxs(block.getTxs());
  blockRef.setTxFeeBase(block.getTxFeeBase());
  blockRef.setTxDistanceSumLimit(block.getTxDistanceSumLimit());
  blockRef.setBlockchainHeadersCount(block.getBlockchainHeadersCount());
  blockRef.setBlockchainHeaderRefs(blockHeadersRef); // set the new header refs
  blockRef.setBlockchainFingerprintsRoot(block.getBlockchainFingerprintsRoot());

  return blockRef;
};

/**
 * Convert a BC Block Reference and returns a BC Block
 *
 * block = BcBlockRef
 */
const convertBlockRefToBlock = exports.convertBlockRefToBlock = (block, persistence) => {

  // invalid data
  if (!block || !block.getBlockchainHeaders && !block.getBlockchainHeaderRefs) {
    throw new Error(`unable to convert malformed data to block`);
  }

  if (!persistence) {
    throw new Error(`persistence must be passed to convert block ref to block`);
  }

  // already a full bc block
  if (block.getBlockchainHeaders) {
    return block;
  }

  // get the child chain blocks
  const blockHeaders = new BlockchainHeaders();
  const headersMap = block.getBlockchainHeaderRefs();
  Object.keys(headersMap.toObject()).reduce((all, listName) => {
    const setMethodName = `set${listName[0].toUpperCase()}${listName.slice(1)}`;
    const getMethodNameRef = `get${listName[0].toUpperCase()}${listName.slice(1)}Ref`;
    const chainHeadersRefs = headersMap[getMethodNameRef]();
    const chainHeaders = chainHeaders.map(async header => {
      return await persistence.getBlockByHash(headerHash, listName);
    });
    blockHeaders[setMethodName](chainHeaderRefs);
  });

  // create the final block reference
  const newBlock = new BcBlock();
  newBlock.setHash(block.getHash());
  newBlock.setPreviousHash(block.getPreviousHash());
  newBlock.setVersion(block.getVersion());
  newBlock.setSchemaVersion(block.getSchemaVersion());
  newBlock.setHeight(block.getHeight());
  newBlock.setMiner(block.getMiner());
  newBlock.setDifficulty(block.getDifficulty());
  newBlock.setTimestamp(block.getTimestamp());
  newBlock.setMerkleRoot(block.getMerkleRoot());
  newBlock.setChainRoot(block.getChainRoot());
  newBlock.setDistance(block.getDistance());
  newBlock.setTotalDistance(block.getTotalDistance());
  newBlock.setNonce(block.getNonce());
  newBlock.setNrgGrant(block.getNrgGrant());
  newBlock.setTwn(block.getTwn());
  newBlock.setTws(block.getTws());
  newBlock.setEmblemWeight(block.getEmblemWeight());
  newBlock.setEmblemChainFingerprintRoot(block.getEmblemChainFingerprintRoot());
  newBlock.setEmblemChainAddress(block.getEmblemChainAddress());
  newBlock.setTxCount(block.getTxCount());
  newBlock.setTxs(block.getTxs());
  newBlock.setTxFeeBase(block.getTxFeeBase());
  newBlock.setTxDistanceSumLimit(block.getTxDistanceSumLimit());
  newBlock.setBlockchainHeadersCount(block.getBlockchainHeadersCount());
  newBlock.setBlockchainHeaders(blockHeaders); // set the new header refs
  newBlock.setBlockchainFingerprintsRoot(block.getBlockchainFingerprintsRoot());

  return newBlock;
};

const toMissingIntervals = exports.toMissingIntervals = blockNumbers => groupWith((a, b) => a - 1 === b, blockNumbers).map(arr => [arr[0], arr[arr.length - 1]]);