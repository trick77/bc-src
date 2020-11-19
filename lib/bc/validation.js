'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isValidBlock = isValidBlock;
exports.isValidChildAge = isValidChildAge;
exports.blockchainHeadersAreChain = blockchainHeadersAreChain;
exports.validateRoveredSequences = validateRoveredSequences;
exports.validateSequenceTotalDistance = validateSequenceTotalDistance;
exports.validateSequenceDifficulty = validateSequenceDifficulty;
exports.validateBlockSequence = validateBlockSequence;
exports.childrenLowestBlock = childrenLowestBlock;
exports.getConfirmationsChildrenNewestBlock = getConfirmationsChildrenNewestBlock;
exports.childrenHighestBlock = childrenHighestBlock;
exports.childrenHeightSum = childrenHeightSum;


const { inspect } = require('util'); /**
                                      * Copyright (c) 2017-present, Block Collider developers, All rights reserved.
                                      *
                                      * This source code is licensed under the MIT license found in the
                                      * LICENSE file in the root directory of this source tree.
                                      *
                                      * 
                                      */

const BN = require('bn.js');
const {
  all,
  range,
  unnest,
  difference,
  aperture,
  equals,
  flatten,
  fromPairs,
  head,
  identity,
  is,
  last,
  min,
  reject,
  reverse,
  sort,
  sum,
  values
} = require('ramda');
const debug = require('debug')('bcnode:validation');
const debugRover = require('debug')('bcnode:validRoverChain');
const debugBestChain = require('debug')('bcnode:bestChain');
const { calcTxFee } = require('bcjs/dist/transaction');

const { getLogger } = require('../logger');
const { blake2bl } = require('../utils/crypto');
const { concatAll } = require('../utils/ramda');
const { humanToBN, internalToBN, MAX_NRG_VALUE, COIN_FRACS: { NRG, BOSON } } = require('../core/coin');
const BC_SUPER_COLLIDER = process.env.BC_SUPER_COLLIDER ? process.env.BC_SUPER_COLLIDER.toLowerCase() : 'bc';
const BC_MAX_NEW_BLOCKS = parseInt(process.env.BC_MAX_NEW_BLOCKS, 10) || 450;
const { COINBASE_TX_ESTIMATE_SIZE, getMaxBlockSize, getMaxDistanceWithEmblems, getNrgGrant, getTxsDistanceSum } = require('../core/txUtils');
const { sortBlocks } = require('../utils/protoBuffers');
const { BcBlock, BlockchainHeader, Block } = require('../protos/core_pb');
const {
  getExpFactorDiff,
  getNewPreExpDifficulty,
  getNewBlockCount,
  getChildrenBlocksHashes,
  getChildrenRootHash,
  getNewestHeader,
  blockchainMapToList,
  createMerkleRoot,
  prepareWork,
  distance,
  BC_MINIMUM_DIFFICULTY
} = require('../mining/primitives');
const GENESIS_DATA = require('./genesis.raw');
const FINGERPRINTS_TEMPLATE = require('../utils/templates/blockchain_fingerprints.json');

const DF_CONFIG = exports.DF_CONFIG = fromPairs(FINGERPRINTS_TEMPLATE.blockchainHeaders.map(({ name, dfNumerator, dfDenominator, dfVoid, dfBound }) => [name, { dfNumerator, dfDenominator, dfVoid, dfBound }]));

const logger = getLogger(__filename);

const keyOrMethodToChain = keyOrMethod => keyOrMethod.replace(/^get|set/, '').replace(/List$/, '').toLowerCase();
const allEqual = arr => arr.every(v => v === arr[0]);
const chainToGet = chain => `get${chain[0].toUpperCase() + chain.slice(1)}List`;

function isValidBlock(newBlock, opts = { fullBlock: true }) {
  if (newBlock === undefined) {
    logger.warn('failed: candidate block is undefined');
    return false;
  }

  if (newBlock.getBlockchainHeaders === undefined) {
    logger.warn('failed: candidate block is undefined candidate block has incomplete child headers references');
    // return false
  }
  // block soft opening limit
  if (new BN(newBlock.getHeight()).lt(new BN(151000))) {
    return true;
  }
  // gpu mining
  if (new BN(newBlock.getHeight()).eq(new BN(303401))) {
    return true;
  }
  // gpu mining
  if (new BN(newBlock.getHeight()).eq(new BN(641452))) {
    return true;
  }
  // overline weighted txs
  if (new BN(newBlock.getHeight()).eq(new BN(1771221)) && newBlock.getPreviousHash() === 'ed0e95c8175035d15088ae2679f09f82d7b50477ad13d71d417563a5472cd150') {
    return true;
  }

  debug(`determining block validity for ${newBlock.getHeight()}.${newBlock.getHash()}`);
  if (!theBlockChainFingerPrintMatchGenesisBlock(newBlock)) {
    logger.debug('failed: theBlockChainFingerPrintMatchGenesisBlock');
    return false;
  } // DISABLED UNTIL AT
  if (!numberOfBlockchainsNeededMatchesChildBlock(newBlock)) {
    logger.debug('failed: numberOfBlockchainsNeededMatchesChildBlock');
    return false;
  }
  if (!ifMoreThanOneHeaderPerBlockchainAreTheyOrdered(newBlock)) {
    logger.debug('failed: ifMoreThanOneHeaderPerBlockchainAreTheyOrdered');
    return false;
  }
  if (!isChainRootCorrectlyCalculated(newBlock)) {
    logger.debug('failed: isChainRootCorrectlyCalculated');
    return false;
  }
  if (!isFieldLengthBounded(newBlock)) {
    logger.debug(`block ${newBlock.getHeight()} failed: isFieldLengthBounded`);
    return false;
  }

  if (parseInt(newBlock.getHeight(), 10) > 665616) {
    if (!isMerkleRootCorrectlyCalculated(newBlock)) {
      logger.debug(`block ${newBlock.getHeight()} failed: isMerkleRootCorrectlyCalculated`);
      return false;
    }
  }

  // DISABLED until OT panelling
  // if (!isValidChildAge(newBlock)) {
  //  return false
  // }
  if (!isDistanceAboveDifficulty(newBlock)) {
    logger.debug(`block ${newBlock.getHeight()} failed: isDistanceAboveDifficulty`);
    return false;
  }
  if (!isDistanceCorrectlyCalculated(newBlock)) {
    logger.debug(`block ${newBlock.getHeight()} failed: isDistanceCorrectlyCalculated`);
    return false;
  }
  debug(`${newBlock.getHeight()}.${newBlock.getHash()} is valid`);

  return true;
}

function isValidChildAge(newBlock, type = 0) {
  if (parseInt(newBlock.getHeight(), 10) < 3) {
    return true;
  }

  const newestHeader = getNewestHeader(newBlock);

  debug('confirming valid child ages for new block');
  if (newestHeader === false) {
    logger.warn('failed: validChildAge no upper limit child header found');
    return false;
  }

  // add the offset for dark fiber
  const bcBlockTimestamp = new BN(newBlock.getTimestamp()).mul(new BN(1000)).toNumber();
  const highRangeLimit = 59 * 1000;
  const lowRangeLimit = 29 * 1000;
  const newestHeaderDFBound = DF_CONFIG[newestHeader.blockchain].dfBound * 1000;
  const newestHeaderTimestamp = new BN(newestHeader.timestamp).add(new BN(newestHeaderDFBound)).toNumber();
  const upperTimestampLimit = new BN(newestHeaderTimestamp).add(new BN(highRangeLimit)).toNumber();
  const lowerTimestampLimit = new BN(newestHeaderTimestamp).sub(new BN(lowRangeLimit)).toNumber();

  debug('bcblocktimestamp timestamp: ' + bcBlockTimestamp);
  debug('newest header bound: ' + newestHeaderDFBound);
  debug('newest header timestamp: ' + newestHeader.timestamp);
  debug('upperTimestampLimit: ' + upperTimestampLimit);
  debug('lowerTimestampLimit: ' + lowerTimestampLimit);

  if (new BN(bcBlockTimestamp).gt(new BN(upperTimestampLimit)) === true) {
    logger.warn('failed: isValidChildAge upper limit');
    return false;
  }

  if (new BN(bcBlockTimestamp).lt(new BN(lowerTimestampLimit)) === true) {
    logger.warn('failed: isValidChildAge lower limit');
    return false;
  }
  return true;
}

function theBlockChainFingerPrintMatchGenesisBlock(newBlock) {
  return newBlock.getBlockchainFingerprintsRoot() === GENESIS_DATA.blockchainFingerprintsRoot;
}

function numberOfBlockchainsNeededMatchesChildBlock(newBlock) {
  debug('numberOfBlockchainsNeededMatchesChildBlock validation running');
  // skip for genesis block - it chas no blockchain blocks embedded
  if (newBlock.getHash() === GENESIS_DATA.hash && newBlock.getHeight() === 1) {
    return true;
  }
  // verify that all blockain header lists are non empty and that there is childBlockchainCount of them
  const headers = newBlock.getBlockchainHeaders();
  if (!headers) {
    debug('Missing blockchain headers in block');
    return false;
  }
  const headerValues = Object.values(headers.toObject());
  debug(inspect(headerValues, { depth: 3 }));
  // $FlowFixMe
  const headerValuesWithLengthGtZero = headerValues.filter(headersList => headersList.length > 0);
  debug(inspect(headerValuesWithLengthGtZero, { depth: 3 }));
  // logger.info(GENESIS_DATA.childBlockchainCount)
  return headerValuesWithLengthGtZero.length === GENESIS_DATA.childBlockchainCount;
}

function ifMoreThanOneHeaderPerBlockchainAreTheyOrdered(newBlock) {
  debug('ifMoreThanOneHeaderPerBlockchainAreTheyOrdered validation running');
  const headersMap = newBlock.getBlockchainHeaders();

  // gather true/false for each chain signalling if either there is only one header
  // (most common case) or headers maintain ordering
  const chainsConditions = Object.keys(headersMap.toObject()).map(listName => {
    const getMethodName = `get${listName[0].toUpperCase()}${listName.slice(1)}`;
    const chainHeaders = headersMap[getMethodName]();
    if (chainHeaders.length === 1) {
      debug(`ifMoreThanOneHeaderPerBlockchainAreTheyOrdered ${listName} single and valid`);
      return true;
    }

    // return true if left height < right height condition is valid
    // for all pairs ([[a, b], [b, c], [c, d]]) of chain headers ([a, b, c, d])
    // (in other words if ordering is maintained)
    // TODO
    const orderingCorrect = all(equals(true), aperture(2, chainHeaders).map(([a, b]) => a.getHeight() < b.getHeight()));
    debug(`ifMoreThanOneHeaderPerBlockchainAreTheyOrdered ${listName} multiple and valid: ${orderingCorrect.toString()}`);
    if (!orderingCorrect) {
      debug(`ifMoreThanOneHeaderPerBlockchainAreTheyOrdered ${inspect(headersMap.toObject())}`);
    }
    return orderingCorrect;
  });

  // check if all chain conditions are true
  debug(`ifMoreThanOneHeaderPerBlockchainAreTheyOrdered all chain conditions: ${inspect(chainsConditions)}`);
  return all(equals(true), chainsConditions);
}

function isChainRootCorrectlyCalculated(newBlock) {
  debug('isChainRootCorrectlyCalculated validation running');
  const receivedChainRoot = newBlock.getChainRoot();

  const expectedBlockHashes = getChildrenBlocksHashes(blockchainMapToList(newBlock.getBlockchainHeaders()));
  const expectedChainRoot = blake2bl(getChildrenRootHash(expectedBlockHashes).toString());
  return receivedChainRoot === expectedChainRoot;
}

function isFieldLengthBounded(newBlock) {
  debug('isFieldLengthBounded validation running');

  const newBlockObject = newBlock.toObject();
  return Object.keys(newBlockObject).reduce((lengthWithinBounds, propName) => {
    if (newBlockObject[propName] !== undefined) {
      if (is(String, newBlockObject[propName])) {
        lengthWithinBounds = newBlockObject[propName].length <= 128;
      }

      if (is(Number, newBlockObject[propName])) {
        lengthWithinBounds = newBlockObject[propName].toString().length <= 128;
      }

      if (is(Array, newBlockObject[propName])) {
        lengthWithinBounds = newBlockObject[propName].length <= 128;
      }
    }
    return lengthWithinBounds;
  }, true);
}

function areDarkFibersValid(newBlock) {
  // eslint-disable-line
  debug('areDarkFibersValid validation running');
  const newBlockTimestampMs = newBlock.getTimestamp() * 1000;
  const blockchainHeadersList = blockchainMapToList(newBlock.getBlockchainHeaders());
  const dfBoundHeadersChecks = blockchainHeadersList.map(header => {
    // e.g. NEO 1000 (rovered ts)  <=    1400 (mined time) -   300 (dfBound for NEO)
    return header.getTimestamp() <= newBlockTimestampMs - DF_CONFIG[header.getBlockchain()].dfBound * 1000;
  });
  debug(`dfBoundHeadersChecks: ${inspect(dfBoundHeadersChecks)}`);

  const dfVoidHeadersChecks = blockchainHeadersList.map(header => {
    const { dfVoid } = DF_CONFIG[header.getBlockchain()];
    return dfVoid === 0 || newBlockTimestampMs < header.getTimestamp() + dfVoid * 1000;
  });
  debug(`dfVoidHeadersChecks: ${inspect(dfVoidHeadersChecks)}`);
  return all(equals(true), dfBoundHeadersChecks) && all(equals(true), dfVoidHeadersChecks);
}

function isMerkleRootCorrectlyCalculated(newBlock) {
  debug('isMerkleRootCorrectlyCalculated validation running');
  const receivedMerkleRoot = newBlock.getMerkleRoot();

  const blockHashes = getChildrenBlocksHashes(blockchainMapToList(newBlock.getBlockchainHeaders()));
  const expectedMerkleRoot = createMerkleRoot(concatAll([blockHashes, newBlock.getTxsList().map(tx => tx.getHash()), [newBlock.getDifficulty(), newBlock.getMiner(), newBlock.getHeight(), newBlock.getVersion(), newBlock.getSchemaVersion(), newBlock.getNrgGrant(), GENESIS_DATA.blockchainFingerprintsRoot]]));

  // LDL
  debug(`test block hashes: ${JSON.stringify(blockHashes, null, 2)} `);
  debug(`test block txs hashes: ${JSON.stringify(newBlock.getTxsList().map(tx => tx.getHash()), null, 2)} `);
  debug(`test new block difficulty: ${newBlock.getDifficulty()} `);
  debug(`test new block miner: ${newBlock.getMiner()} `);
  debug(`test block height: ${newBlock.getHeight()} `);
  debug(`test version: ${newBlock.getVersion()} `);
  debug(`test schema: ${newBlock.getSchemaVersion()} `);
  debug(`test nrg grant: ${newBlock.getNrgGrant()} `);
  debug(`test fingerprints root: ${GENESIS_DATA.blockchainFingerprintsRoot}`);
  debug(`test expected merkle root: ${expectedMerkleRoot}`);
  debug(`test received merkle root: ${receivedMerkleRoot}`);

  return receivedMerkleRoot === expectedMerkleRoot;
}

function isDistanceAboveDifficulty(newBlock) {
  debug(`isDistanceAboveDifficulty validation running on ${newBlock.getHeight()}`);
  const receivedDistance = newBlock.getDistance();
  const receivedDifficulty = newBlock.getDifficulty(); // !! NOTE: This is the difficulty for THIS block and not for the parent.
  debug(`receivedDistance ${receivedDistance}, receivedDifficulty ${receivedDifficulty}`);
  return new BN(receivedDistance).gt(new BN(receivedDifficulty));
}

function isDistanceCorrectlyCalculated(newBlock) {
  debug(`isDistanceCorrectlyCalculated validation running on ${newBlock.getHeight()}.${newBlock.getHash()}`);
  const receivedDistance = newBlock.getDistance();

  const expectedWork = prepareWork(newBlock.getPreviousHash(), newBlock.getBlockchainHeaders());
  debug(`isDistanceCorrectlyCalculated validation running on ${newBlock.getHeight()}.${newBlock.getHash()} expected work: ${expectedWork}`);

  const expectedDistance = distance(expectedWork, blake2bl(newBlock.getMiner() + newBlock.getMerkleRoot() + blake2bl(newBlock.getNonce()) + newBlock.getTimestamp())).toString();

  const res = receivedDistance === expectedDistance;
  if (!res) {
    debug(`isDistanceCorrectlyCalculated, receivedDistance = ${receivedDistance}, expectedDistance = ${expectedDistance}`);
  }

  return res;
}

function blockchainHeadersAreChain(childHeaderList, parentHeaderList, mountBlockHeaderList) {
  const firstChildHeader = head(childHeaderList);
  const lastChildHeader = last(childHeaderList);
  const lastParentHeader = last(parentHeaderList);
  let mountBlockHeader = false;

  debug(`childHeaderList ${childHeaderList.length}`);
  if (mountBlockHeaderList) {
    mountBlockHeader = mountBlockHeaderList.find(b => {
      if (b.getHash() === firstChildHeader.getPreviousHash()) {
        return b;
      }
    });
  }

  if (mountBlockHeader) {
    debug(`last mount block header ${mountBlockHeader.getBlockchain()} -> ${mountBlockHeader.getHeight()} : ${mountBlockHeader.getHash().slice(0, 21)}`);
    debug(`first child header ${firstChildHeader.getBlockchain()} -> ${firstChildHeader.getHeight()} : ${firstChildHeader.getHash().slice(0, 21)} : PREV ${firstChildHeader.getPreviousHash()}`);
    debug(`last child header ${lastChildHeader.getBlockchain()} -> ${lastChildHeader.getHeight()} : ${lastChildHeader.getHash().slice(0, 21)} : PREV ${lastChildHeader.getPreviousHash()}`);
    debug(`last parent header ${lastParentHeader.getBlockchain()} -> ${lastParentHeader.getHeight()} : ${lastParentHeader.getHash().slice(0, 21)} : PREV ${lastParentHeader.getPreviousHash()}`);
  }

  firstChildHeader.getBlockchain() === 'eth' && debug('list: %O, first: %O', childHeaderList.map(c => c.toObject()), firstChildHeader.toObject());

  debug('blockchainHeadersAreChain() child list length: %d, parent list length: %d', childHeaderList.length, parentHeaderList.length);
  // check if both parent and child have at least one header
  if (!firstChildHeader || !lastParentHeader) {
    const nonEmpty = firstChildHeader || lastParentHeader;
    if (nonEmpty) {
      logger.warn(`first child header or last parent header were empty for chain ${nonEmpty.getBlockchain()}`);
    } else {
      logger.warn(`both first child header and last parent header were missing`);
    }
    logger.warn('blockchainHeadersAreChain() not valid because no headers in list');
    return false;
  }

  // check if either the header is the same one or first child header is actual child of last parent header
  let check = firstChildHeader.getPreviousHash() === lastParentHeader.getHash() || childHeaderList.length === 1 && firstChildHeader.getHash() === lastParentHeader.getHash() || childHeaderList.length > 2 && mountBlockHeader && parseInt(firstChildHeader.getHeight(), 10) < parseInt(lastParentHeader.getHeight(), 10) && parseInt(lastChildHeader.getHeight(), 10) > parseInt(lastParentHeader.getHeight(), 10) && firstChildHeader.getPreviousHash() !== lastParentHeader.getPreviousHash() && firstChildHeader.getHash() !== lastParentHeader.getPreviousHash() || childHeaderList.length === 1 && firstChildHeader.getHeight() === lastParentHeader.getHeight() && firstChildHeader.getHash() !== lastParentHeader.getHash() && firstChildHeader.getPreviousHash() === lastParentHeader.getPreviousHash();

  if (!check) {
    debug(`child header list length: ${childHeaderList.length} parent header list length: ${parentHeaderList.length}`);
    debug('first condition %o %s %s', firstChildHeader.getPreviousHash() === lastParentHeader.getHash(), firstChildHeader.getPreviousHash(), lastParentHeader.getHash());
    debug('second condition %o %s %s', childHeaderList.length > 2, firstChildHeader.getPreviousHash(), lastParentHeader.getHash());
    debug('third condition %o %s %s', firstChildHeader.getHash() === lastParentHeader.getHash(), firstChildHeader.getHash(), lastParentHeader.getHash());
    debug(`chain: "${firstChildHeader.getBlockchain()}" first child header ${inspect(firstChildHeader.toObject())} is not a child of last parent header ${inspect(lastParentHeader.toObject())}`);
    return check;
  }

  // if more than one child header check if child headers form a chain
  if (childHeaderList.length > 1) {
    check = aperture(2, childHeaderList).reduce((result, [a, b]) => {
      debug('checking chain %o blocks %d < %d, %s %s, %s', a.getBlockchain(), a.getHeight(), b.getHeight(), a.getHash() === b.getPreviousHash(), a.getHash(), b.getPreviousHash());
      return a.getHash() === b.getPreviousHash() && result;
    }, true);

    if (!check) {
      debug(`child headers do not form a chain`);
      return check;
    }
  }

  // if more than one parent header check if parent headers form a chain
  if (parentHeaderList.length > 1) {
    check = aperture(2, parentHeaderList).reduce((result, [a, b]) => a.getHash() === b.getPreviousHash() && result, true);

    if (!check) {
      debug(`parent headers do not form a chain`);
      return check;
    }
  }

  // if more than one parent header check if parent headers form a chain
  if (mountBlockHeader && mountBlockHeaderList.length > 1) {
    check = aperture(2, mountBlockHeaderList).reduce((result, [a, b]) => a.getHash() === b.getPreviousHash() && result, true);

    if (!check) {
      debug(`mount block headers do not form a chain`);
      return check;
    }
  }

  return true;
}

const validateTxs = exports.validateTxs = async (txHandler, block) => {
  let height = block.getHeight();
  let txs = block.getTxsList();

  if (!txs || txs.length < 1) {
    logger.error(`missing argument txs`);
    return false;
  }

  if (height && height < 2) {
    logger.error(`cannot process txs for block height less than 2 (given: ${height}`);
    return true;
  }

  debug(`processing ${txs.length} txs for ${block.getHash()}`);
  const validTxs = await txHandler.validateTxs(block);

  // ensure txs cannot be spending the same outpoint
  let outpoints = {};
  txs.forEach(tx => {
    for (let input of tx.getInputsList()) {
      let key = `${input.getOutPoint().getHash()}.${input.getOutPoint().getIndex()}`;
      if (outpoints[key]) {
        debug(`Trying to spent same outpoint`);
        // console.log('trying to spend same outpoint')
        return false;
      } else outpoints[key] = true;
    }
  });
  return validTxs;
};

const getCoinbaseMissingBlockHeight = exports.getCoinbaseMissingBlockHeight = async (block, persistence, txHandler, calledFrom) => {
  if (!block || block.getTxsList === undefined) return false;
  debug(`${block.getHeight()}:${block.getHash()} from ${calledFrom}`);
  let date = Date.now();
  let alreadySaved = await persistence.areUTXOsSavedForBlock(block.getHeight(), block.getHash());
  debug(`check if utxos are already saved: ${alreadySaved}`);
  if (alreadySaved) return true;
  debug(`loading utxo simplex...`);
  const utxoSimplex = persistence._chainState.getSimplexCache();
  debug(`...utxo simplex is ${utxoSimplex}`);
  if (utxoSimplex) {
    debug(`utxo pruning in progress, yielding request for block ${block.getHeight()}, simplex is ${utxoSimplex}`);
    return false;
  } else {
    debug(`setting simplex in chainstate`);
    persistence._chainState.setSimplexCache(`Validating ${block.getHeight()}.${block.getHash()}`);
    debug(`simplex set in chainstate`);
  }

  let blocksToAdd = [block];
  let returnBlock = false;

  while (true) {
    // LDL
    debug(`while checking ${block.getHeight()}`);
    if (parseInt(block.getHeight(), 10) === 1) break;
    let alreadySaved = await persistence.areUTXOsSavedForBlock(block.getHeight() - 1, block.getPreviousHash());
    if (alreadySaved) break;
    debug(`loading block by hash ${block.getHash()}`);
    returnBlock = block;
    block = await persistence.getBlockByHash(block.getPreviousHash(), 'bc', { cached: true });
    if (!block) {
      // LDL
      // logger.info(`${parseInt(block.getHeight(), 10) - 1} : ${block.getPreviousHash()} unavailable...`)
      persistence._chainState.delSimplexCache();
      return parseInt(returnBlock.getHeight(), 10) - 1;
    }
    blocksToAdd.unshift(block);
  }

  for (let b of blocksToAdd) {
    debug(`in for loop parsing ${b.getHash()}`);
    let validBlock = await isCoinbaseValid(b, persistence, txHandler);
    if (validBlock === false) {
      logger.warn(`utxo coinbase unresolved ${b.getHeight()} : ${b.getHash().slice(0, 8)}`);
      persistence._chainState.delSimplexCache();
      return false;
    }
  }
  // console.log(`Took ${Date.now() - date} secs - Block #${blocksToAdd[blocksToAdd.length-1].getHeight()}.${blocksToAdd[blocksToAdd.length-1].getHash()} to validate`)
  persistence._chainState.delSimplexCache();
  persistence._engine._emitter.emit('utxo.simplex');
  return false;
};

const validateCoinbase = exports.validateCoinbase = async (block, persistence, txHandler, calledFrom) => {
  if (!block || block.getTxsList === undefined) return false;
  debug(`${block.getHeight()}:${block.getHash()} from ${calledFrom}`);
  let date = Date.now();
  let alreadySaved = await persistence.areUTXOsSavedForBlock(block.getHeight(), block.getHash());
  debug(`check if utxos are already saved: ${alreadySaved}`);
  if (alreadySaved) return true;
  debug(`loading utxo simplex...`);
  const utxoSimplex = persistence._chainState.getSimplexCache();
  // if(utxoSimplex !== null) logger.info(`...utxo simplex is ${utxoSimplex} within ${block.getHash()}`)
  if (utxoSimplex) {
    debug(`utxo pruning in progress, yielding request for block ${block.getHeight()}, simplex is ${utxoSimplex}`);
    return false;
  } else {
    debug(`setting simplex in chainstate`);
    persistence._chainState.setSimplexCache(`Validating ${block.getHeight()}.${block.getHash()}`);
    debug(`simplex set in chainstate`);
  }

  let blocksToAdd = [block];

  // LDL
  debug(`check from ${block.getHeight() - 1}`);
  while (true) {
    // LDL
    debug(`while checking ${block.getHeight() - 1}, ${block.getPreviousHash()}`);
    if (parseInt(block.getHeight(), 10) === 1) break;
    let alreadySaved = await persistence.areUTXOsSavedForBlock(block.getHeight() - 1, block.getPreviousHash());
    let prevHash = block.getPreviousHash();
    let prevHeight = block.getHeight() - 1;
    if (alreadySaved) {
      // block = await persistence.getBlockByHash(prevHash, 'bc')
      // blocksToAdd.unshift(block)
      break;
    }
    block = await persistence.getBlockByHash(prevHash, 'bc');
    if (!block) {
      // LDL
      logger.info(`${prevHeight} : ${prevHash} <- unavailable`);
      persistence._chainState.delSimplexCache();
      return false;
    }
    blocksToAdd.unshift(block);
  }
  debug(`check to ${block.getHeight()}`);

  for (let b of blocksToAdd) {
    debug(`in for loop parsing ${b.getHeight()}-${b.getHash()}`);
    let validBlock = await isCoinbaseValid(b, persistence, txHandler);
    if (validBlock === false) {
      logger.warn(`utxo coinbase unresolved ${b.getHeight()} : ${b.getHash().slice(0, 8)}`);
      persistence._chainState.delSimplexCache();
      return false;
    }
  }
  // console.log(`Took ${Date.now() - date} secs - Block #${blocksToAdd[blocksToAdd.length-1].getHeight()}.${blocksToAdd[blocksToAdd.length-1].getHash()} to validate`)
  persistence._chainState.delSimplexCache();
  persistence._engine._emitter.emit('utxo.simplex');
  return true;
};

const isCoinbaseValid = exports.isCoinbaseValid = async (block, persistence, txHandler) => {
  let success = await persistence.removeUTXOsFrom(block.getHeight());
  if (!success) return false;

  if (block.getHeight() !== 1) {
    // ensure we have the utxo set up to date
    let blockTxs = block.getTxsList();

    let validTxs = await validateTxs(txHandler, block);

    if (!validTxs) {
      // LDL
      logger.warn(`invalid txs within block - Block #${block.getHeight()}.${block.getHash()}`);
      return false;
    }
    // console.log(`Tx validation took ${Date.now() - date} ms - Block #${block.getHeight()}.${block.getHash()}`)

    const minerAddress = block.getMiner();
    const txsDistanceSum = getTxsDistanceSum(blockTxs);
    const emblemObject = await getMaxDistanceWithEmblems(minerAddress, persistence);
    let mintedNrg = await persistence.getNrgMintedSoFar();
    if (!mintedNrg) {
      mintedNrg = 0;
    }
    let nrgGrant = 0;
    if (mintedNrg < MAX_NRG_VALUE) {
      nrgGrant = getNrgGrant(emblemObject.emblemBonus, emblemObject.totalDistance, txsDistanceSum, parseInt(block.getHeight(), 10));
    }
    if (mintedNrg + nrgGrant > MAX_NRG_VALUE) {
      nrgGrant = MAX_NRG_VALUE - mintedNrg;
    }

    // ensure that there is only one coinbase tx
    const numCoinbase = blockTxs.reduce((numCoinbase, tx) => {
      if (tx.getInputsList().length === 0) numCoinbase++;
      return numCoinbase;
    }, 0);
    if (numCoinbase !== 1) {
      logger.warn('Incorrect number of coinbase txs');
      return false;
    }

    const txFees = blockTxs.map(tx => calcTxFee(tx)).reduce((fee, sum) => sum.add(fee), new BN(0));
    debug(`grant is ${nrgGrant}`);
    debug(`txFees is ${txFees.toString()}`);

    let grant = humanToBN(`${nrgGrant}`, NRG).add(new BN(txFees));
    const coinbaseTx = blockTxs[0];
    const outputs = coinbaseTx.getOutputsList();
    const inputs = coinbaseTx.getInputsList();
    if (outputs.length !== 1) {
      logger.warn(`invalid coinbase transaction <- required 1 output, given ${outputs.length}`);
      return false;
    }
    if (inputs.length !== 0) {
      logger.warn(`invalid coinbase transaction <- required 0 inputs, given ${inputs.length}`);
      return false;
    }
    const output = outputs[0];
    const coinbaseTxValue = internalToBN(output.getValue(), BOSON);

    if (!coinbaseTxValue.eq(grant)) {
      logger.warn(`invalid coinbase transaction <- direct value from coinbase ${coinbaseTxValue} calculated value ${grant}`);
      return false;
    }

    let txsSizeSoFar = 0;
    let validBlockSize = true;
    const maxBlockSize = (await getMaxBlockSize(block.getMiner(), persistence)) - COINBASE_TX_ESTIMATE_SIZE;

    for (let tx of blockTxs) {
      if (tx.getInputsList().length > 0) {
        const thisTxSize = tx.serializeBinary().length;
        if (txsSizeSoFar + thisTxSize > maxBlockSize) {
          validBlockSize = false;
        }
        txsSizeSoFar += thisTxSize;
      }
    }

    if (!validBlockSize) {
      logger.info(`Block ${block.getHeight()} too large`);
      // console.log('block too large')
      return false;
    }
  }

  let validated = await persistence.updateUTXOs(block);
  return validated;
};

const validateRequireMountBlock = exports.validateRequireMountBlock = (newBlock, latestBlock) => {
  debug(`comparing new block ${newBlock.getHeight()} with ${latestBlock.getHeight()}`);
  const newBlockHeaders = newBlock.getBlockchainHeaders();
  const needsMountBlock = [];
  if (parseInt(newBlock.getHeight(), 10) - 1 !== parseInt(latestBlock.getHeight(), 10) || newBlock.getHeight() < 3) {
    // can only be between two consequtive blocks
    return false;
  }

  Object.keys(newBlockHeaders.toObject()).map(listName => {
    const rov = listName.replace('List', '');
    const p = last(latestBlock.getBlockchainHeaders()[chainToGet(rov)]());
    const c = head(newBlock.getBlockchainHeaders()[chainToGet(rov)]());
    if (c && p && c.getHeight && p.getHeight) {
      debug(`comparing child ${c.getHeight()} with parent ${p.getHeight()}`);
      if (c.getHeight() < p.getHeight()) {
        needsMountBlock.push(c);
      }
    }
  });
  if (needsMountBlock.length < 1) {
    return false;
  }
  return needsMountBlock;
};

function validateRoveredSequences(blocks, mountBlock) {
  const sortedBlocks = sort((a, b) => b.getHeight() - a.getHeight(), blocks);
  const checks = aperture(2, sortedBlocks).map(([child, parent]) => {
    return parent.getHeight() === GENESIS_DATA.height || validateChildHeadersSequence(child, parent, mountBlock);
  });

  debug(`validateRoveredSequences: ${inspect(checks)}`);

  return all(equals(true), flatten(checks));
}

function validateSequenceTotalDistance(previousBlock, newBlock) {
  // LDL
  debug('comparing total distances previous block: ' + previousBlock.getHeight() + ' with next block ' + newBlock.getHeight());

  // soft period
  if (new BN(newBlock.getHeight()).lt(new BN(40000)) && new BN(newBlock.getTimestamp()).lt(new BN(1584771657))) {
    return true;
  }

  const combinedDistance = new BN(newBlock.getDistance()).add(new BN(previousBlock.getTotalDistance()));
  // const chainWeight = new BN(lastPreviousBlock.getDistance()).sub(new BN(previousBlock.getDifficulty())).divRound(new BN(8)).toString()

  // unfinishedBlock.setTotalDistance(new BN(unfinishedBlock.getTotalDistance()).add(new BN(chainWeight)).add(new BN(unfinishedBlock.getDifficulty(), 10)).toString())
  const claimedDistance = new BN(newBlock.getTotalDistance()).eq(combinedDistance);

  // LDL
  debug('combined distances: ' + ' is ' + combinedDistance);
  debug(' distance on prev block ' + previousBlock.getDistance());
  debug(' distance on new block ' + newBlock.getDistance());
  debug('final total distance on prev block ' + previousBlock.getTotalDistance());

  debug('final total distance on new block ' + newBlock.getTotalDistance());
  return claimedDistance;
}

function validateSequenceDifficulty(previousBlock, newBlock) {
  // logger.info('comparing difficulties prevBlock: ' + previousBlock.getHeight() + ' with next block ' + newBlock.getHeight())
  if (previousBlock && newBlock && previousBlock.getHeight && newBlock.getHeight && parseInt(previousBlock.getHeight(), 10) < 4 && parseInt(newBlock.getHeight(), 10) < 4) {
    return true;
  }

  const newBlockCount = parseInt(previousBlock.getHeight(), 10) === 1 ? 1 : getNewBlockCount(previousBlock.getBlockchainHeaders(), newBlock.getBlockchainHeaders());
  // logger.info(`new block count A ${newBlockCount}`)

  // const preExpDiff = getDiff(
  //	newBlock.getTimestamp()
  //  previousBlock.getTimestamp(),
  //  previousBlock.getDifficulty(),
  //  BC_MINIMUM_DIFFICULTY,
  //  newBlockCount,
  //  getNewestHeader(newBlock)
  // )

  const preExpDiff = getNewPreExpDifficulty(newBlock.getTimestamp(), previousBlock, getNewestHeader(newBlock), newBlockCount);

  const finalDifficulty = getExpFactorDiff(preExpDiff, previousBlock.getHeight()).toString();
  debug('comparing difficulties prevBlock: ' + previousBlock.getHeight() + ' (' + previousBlock.getDifficulty() + ') with next block ' + newBlock.getHeight() + ' (' + newBlock.getDifficulty() + ') ');

  if (new BN(BC_MINIMUM_DIFFICULTY).gt(new BN(finalDifficulty))) {
    debug('difficulty should be equal ' + new BN(BC_MINIMUM_DIFFICULTY).toNumber());
    return true;
  }
  debug('difficulty should be equal ' + new BN(finalDifficulty).toNumber());
  debug(`difficulty equality is ${new BN(newBlock.getDifficulty()).eq(new BN(finalDifficulty))}`);
  return new BN(newBlock.getDifficulty()).eq(new BN(finalDifficulty));
}

function validateChildHeadersSequence(childBlock, parentBlock, mountBlock) {
  const childBlockchainHeaders = childBlock.getBlockchainHeaders();
  const parentBlockchainHeaders = parentBlock.getBlockchainHeaders();
  const mountBlockHeaders = mountBlock ? mountBlock.getBlockchainHeaders() : false;

  if (mountBlock) {
    debug(`mount block ${mountBlock.getHeight()} : ${mountBlock.getHash().slice(0, 21)} provided to validate child headers child ${childBlock.getHeight()} -> parent ${parentBlock.getHeight()} `);
  }

  return Object.keys(childBlockchainHeaders.toObject()).map(listName => {
    const getMethodName = `get${listName[0].toUpperCase()}${listName.slice(1)}`;
    debug('validateChildHeadersSequence() checking %s using %s', listName, getMethodName);
    if (mountBlockHeaders) {
      return blockchainHeadersAreChain(childBlockchainHeaders[getMethodName](), parentBlockchainHeaders[getMethodName](), mountBlockHeaders[getMethodName]());
    }
    return blockchainHeadersAreChain(childBlockchainHeaders[getMethodName](), parentBlockchainHeaders[getMethodName]());
  });
}

function validateBlockSequence(blocks, mountBlock) {
  // if any of the submissions are undefined reject the sequence
  /*
   * REPORT {
   *   valid: if the sequence is valid
   *   schedules: any child chain heights where bc blocks should again be evaluated
   * }
   */
  const report = { valid: false, schedules: [] };
  if (reject(identity, blocks).length > 0) {
    // LDL
    logger.info('undefined members in set');
    return report;
  }
  // BC: 10 > BC: 9 > BC: 8 ...
  const sortedBlocks = sortBlocks(blocks, 'desc');
  const edgeBlock = sortedBlocks[0];
  const edgeBlockchain = edgeBlock.getBlockchain ? edgeBlock.getBlockchain() : 'bc';

  // BC: 8 < BC: 9 < BC: 10 ...
  const sortedBlocksTopDown = reverse(sortedBlocks);

  // LDL
  debug(`validateBlockSequence sorted blocks ${sortedBlocks.map(b => b.getHeight()).toString()}`);
  // validate that Bc blocks are all in the same chain
  const validPairs = aperture(2, sortedBlocks).map(([a, b]) => {
    if (a.getPreviousHash() !== b.getHash()) {
      if (a.getBlockchain) {
        // LDL
        debug('blockchain failed: ' + a.getBlockchain() + ' prev: ' + a.getPreviousHash() + ' current: ' + a.getHash() + ' at height ' + a.getHeight());
      } else {
        // LDL
        debug('blockchain failed: ' + a.getPreviousHash() + ' current: ' + a.getHash() + ' at height ' + a.getHeight());
      }
    }
    return a.getPreviousHash() === b.getHash();
  });

  // LDL
  debug(`syncing multiverse <- ${aperture(2, sortedBlocks.map(b => b.getHeight()))} : ${edgeBlock.getHash()}`);
  // logger.info(`<- ${aperture(2, sortedBlocks.map(b => b.getHeight()))} : ${edgeBlock.getHash()}`)
  if (!all(equals(true), validPairs)) {
    // LDL
    debug(`validateBlockSequence validPairs: ${validPairs}`);
    report.valid = false;
    return report;
  }

  const validDifficulties = aperture(2, sortedBlocksTopDown).map(([a, b]) => {
    return validateSequenceDifficulty(a, b);
  });

  const validDistances = aperture(2, sortedBlocksTopDown).map(([a, b]) => {
    return validateSequenceTotalDistance(a, b);
  });
  /// LDL
  debug(`validateBlockSequence sorted blocks ${inspect(aperture(2, sortedBlocks.map(b => b.getHeight())))}`);
  if (!all(equals(true), validDifficulties)) {
    // LDL
    debug('validateBlockSequence total distances Difficulties');
    report.valid = false;
    return report;
  }

  if (!all(equals(true), validDistances)) {
    // LDL
    debug('validateBlockSequence invalid Distances');
    report.valid = false;
    return report;
  }
  // validate that highest header from each blockchain list from each block maintains ordering
  // [[BC10, BC9], [BC9, BC8]]
  const pairs = aperture(2, sortedBlocks);
  const heights = pairs.map(a => {
    debug(a);
    return [a[0].getHeight(), a[1].getHeight()];
  });
  debug(heights);
  // LDL
  debug('pairs printed after this --> ' + JSON.stringify(heights, null, 2));
  // now create:
  // [[btcOrdered, ethOrdered, lskOrdered, neoOrdered, wavOrdered], [btcOrderder, ethOrdered, lskOrdered, neoOrdered, wavOrdered]]
  //                                e.g. BC10, BC9
  if (mountBlock) {
    debug(`validate block sequences given mount block: ${mountBlock.getHeight()} : ${mountBlock.getHash().slice(0, 21)}`);
  }
  const validPairSubchains = pairs.map(([child, parent]) => {
    return parent.getHeight() === GENESIS_DATA.height ? [true] : validateChildHeadersSequence(child, parent, mountBlock);
  });

  debug(' ---- valid pair subchains --- ');
  debug(validPairSubchains);

  // flatten => [btc10_9Ordered, eth10_9Ordered, lsk10_9Ordered, neo10_9Ordered, wav10_9Ordered, btc9_8Orderded, eth9_8Ordered, lsk9_8Ordered, neo9_8Ordered, wav9_8Ordered]
  // LDL
  debug(`validateBlockSequence validPairSubchains ${inspect(validPairSubchains)}`);
  if (!all(equals(true), flatten(validPairSubchains))) {
    logger.warn('failed test of rovers valid pair subchains, creating schedules');
    const schedules = validPairSubchains.reduce((roster, pairStatus, i) => {
      if (!all(equals(true), validPairSubchains[i])) {
        if (pairs[i] && pairs[i].length > 0) {
          const blockchain = pairs[i][0].getBlockchain ? pairs[i][0].getBlockchain() : 'bc';
          const height = pairs[i][0].getHeight();
          const val = edgeBlockchain;
          // async scheduleAtBlockHeight (height: number, operation: SupportedScheduledOperations, key: string, value: any = '', blockchain: string = 'bc', opts: Object = { asBuffer: true }): Promise<boolean|string> {
          const schedule = [height, 'extendmultiverse', edgeBlockchain, // the blockchain to be evaluated later
          edgeBlock.getHash(), // the hash of the block to be evaluated later
          blockchain // blockchain to schedule
          ];
          if (!roster[blockchain]) {
            roster[blockchain] = schedule;
          } else {
            // only take the highest schedule
            if (new BN(roster[blockchain][0]).lt(new BN(schedule[0]))) {
              roster[blockchain] = schedule;
            }
          }
        }
      }
      return roster;
    }, {});
    const chainsToSchedule = Object.keys(schedules);
    if (chainsToSchedule.length > 0) {
      report.schedules = chainsToSchedule.reduce((set, chain) => {
        set.push(schedules[chain]);
        return set;
      }, []);
    }
    return report; // TODO: AT -> is enabled in validation
  }

  report.valid = true;

  return report;
}

function childrenLowestBlock(block) {
  const allHeaders = values(block.getBlockchainHeaders().toObject());
  const lowest = allHeaders.reduce((all, headers) => {
    const top = headers.sort((a, b) => {
      if (a.height > b.height) {
        return -1;
      }
      if (a.height < b.height) {
        return 1;
      }
      return 0;
    }).pop();

    if (top !== undefined) {
      all[top.blockchain] = top;
    }
    return all;
  }, {});

  const set = values(lowest);

  if (set.length < 1) {
    return [{ height: 1 }];
  } else {
    return set;
  }
}

function getConfirmationsChildrenNewestBlock(block) {
  const allHeaders = values(block.getBlockchainHeaders().toObject());
  const highest = allHeaders.reduce((all, headers) => {
    const top = headers.sort((a, b) => {
      if (a.timestamp > b.timestamp) {
        return 1;
      }
      if (a.timestamp < b.timestamp) {
        return -1;
      }
      return 0;
    }).pop();

    if (top !== undefined) {
      all[top.blockchain] = top;
    }
    return all;
  }, {});

  const newestBlockchain = Object.keys(highest).reduce((all, chain) => {
    if (!all.blockchain) {
      all = {
        blockchain: chain,
        timestamp: highest[chain].timestamp
      };
    } else if (all.timestamp < highest[chain].timestamp) {
      all = {
        blockchain: chain,
        timestamp: highest[chain].timestamp
      };
    }
    return all;
  }, { timestamp: 0, blockchain: false });

  const report = {
    input: {},
    output: {}
  };

  report.input = Object.keys(highest).reduce((all, chain) => {
    if (chain !== newestBlockchain.blockchain) {
      all[chain] = highest[chain].blockchainConfirmationsInParentCount;
    }
    return all;
  }, {});

  report.output[newestBlockchain.blockchain] = 1;
  return report;
}

function childrenHighestBlock(block) {
  const allHeaders = values(block.getBlockchainHeaders().toObject());
  const highest = allHeaders.reduce((all, headers) => {
    const top = headers.sort((a, b) => {
      if (a.height > b.height) {
        return 1;
      }
      if (a.height < b.height) {
        return -1;
      }
      return 0;
    }).pop();

    if (top !== undefined) {
      all[top.blockchain] = top;
    }
    return all;
  }, {});

  const set = values(highest);

  if (set.length < 1) {
    return [{ height: 1 }];
  } else {
    return set;
  }
}

function childrenHeightSum(block) {
  return sum(childrenHighestBlock(block).map(header => Number(header.height)));
}

const validRoverChain = exports.validRoverChain = async (rovers, persistence, collideAtEdge = false) => {
  // collider is starting up
  let totalNewBlocks = 0;
  let currentBlocks = [];
  let finalBlocks = [];
  const updateMultiverse = [];
  const missingBlocksIndex = [];
  const missingBlocks = {};
  const lastPreviousBlock = await persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);

  if (!lastPreviousBlock) {
    const msg = `${BC_SUPER_COLLIDER}.block.latest not available on disk`;
    logger.error(msg);
    return Promise.reject(new Error(msg));
  }

  // XXX
  debugRover(`local persisted ${BC_SUPER_COLLIDER} block height: ${lastPreviousBlock.getHeight()}`);
  // [eth.block.latest,btc.block.latest,neo.block.latest...]
  const latestRoveredHeadersKeys = rovers.map(chain => `${chain}.block.latest`);
  debugRover(`${latestRoveredHeadersKeys}`);

  const latestBlockHeaders = await persistence.getBulk(latestRoveredHeadersKeys);
  if (latestBlockHeaders.length < rovers.length) {
    debugRover(`${latestBlockHeaders.length}/${rovers.length} ready for mining`);
    return false;
  }

  // for overline research station nodes who must depend on rovers only
  if (collideAtEdge) {
    logger.warn(`assembling Overline multiverse with collide from edge enabled ${latestRoveredHeadersKeys.join(', ')}`);
    return Promise.resolve({ bestChain: latestBlockHeaders, missingBlocks: missingBlocks });
  }

  if (!all(h => !!h && !!h.getBlockchain, latestBlockHeaders)) {
    debugRover(`could not get all latestBlockHeaders, missing ${difference(rovers, latestBlockHeaders.filter(a => a).map(h => h.getBlockchain()))}`);
    return false;
  }

  // { eth: 200303, btc:2389, neo:933 }
  const latestBlockHeadersHeights = fromPairs(latestBlockHeaders.map(header => [header.getBlockchain(), header.getHeight()]));
  debugRover(`latestBlockHeadersHeights: ${inspect(latestBlockHeadersHeights)}`);
  debugBestChain(`latestBlockHeadersHeights: ${inspect(latestBlockHeadersHeights)}`);
  const latestBlockHeadersHashes = fromPairs(latestBlockHeaders.map(header => [header.getBlockchain(), header.getHash()]));
  debugRover(`latestBlockHeadersHashes: ${inspect(latestBlockHeadersHashes)}`);

  const newBlockHeadersKeys = flatten(Object.keys(lastPreviousBlock.getBlockchainHeaders().toObject()).map(listKey => {
    // debugRover('assembling minimum heights for ' + listKey)
    const chain = keyOrMethodToChain(listKey);
    const lastHeaderInPreviousBlock = last(lastPreviousBlock.getBlockchainHeaders()[chainToGet(chain)]());

    let from;
    let to;
    if (lastPreviousBlock.getHeight() === 1) {
      // genesis
      from = latestBlockHeadersHeights[chain];
      to = latestBlockHeadersHeights[chain];
    } else {
      from = lastHeaderInPreviousBlock.getHeight();
      to = latestBlockHeadersHeights[chain] + 1;
    }

    debugRover(`newBlockHeadersKeys, heights nrg: ${lastPreviousBlock.getHeight()}, ${chain} ln: ${from}, ${to}`);
    debugBestChain(`newBlockHeadersKeys, heights nrg: ${lastPreviousBlock.getHeight()}, ${chain} ln: ${from}, ${to}`);

    totalNewBlocks = totalNewBlocks + to - from;

    if (from === to) {
      return [`${chain}.block.${from}`];
    }

    if (from > to) {
      return [];
    }

    if (to === undefined) {
      to = from + 1;
    }

    return [range(from, to + 1).map(height => `${chain}.block.${height}`)];
  }));

  debug(`assembled multiverse from ${newBlockHeadersKeys.length} edges with ${totalNewBlocks} connected chain blocks`);

  // debugRover(`attempting to get ${inspect(newBlockHeadersKeys)}`)

  // get latest known BC block
  // debugRover('attempting to get new block headers keys')
  // debugRover(newBlockHeadersKeys)

  // let blocksFromDisk = await Promise.all(newBlockHeadersKeys.map(async (key) => {
  //   const opts = await persistence.getBlocksByHeight(key.split('.').pop(), key.split('.').shift(), {asHeader: true})
  //   if (opts) {
  //     // debugRover(`loaded block ${key}`)
  //     return opts
  //   } else {
  //     debugRover(`failed to load block ${key}`)
  //     return opts
  //   }
  // }))

  const edgesFound = {};
  const savedReads = {};
  const blocksAdded = {};
  let loaded = { btc: { high: 0, low: Infinity }, eth: { high: 0, low: Infinity }, wav: { high: 0, low: Infinity }, lsk: { high: 0, low: Infinity }, neo: { high: 0, low: Infinity } };
  let failed = { btc: { high: 0, low: Infinity }, eth: { high: 0, low: Infinity }, wav: { high: 0, low: Infinity }, lsk: { high: 0, low: Infinity }, neo: { high: 0, low: Infinity } };
  let blocksFromDisk = [];

  for (const key of newBlockHeadersKeys) {
    let height = key.split('.').pop();
    let chain = key.split('.').shift();

    if (!blocksAdded[chain]) {
      blocksAdded[chain] = 0;
      edgesFound[chain] = 0;
      savedReads[chain] = 0;
    }

    if (edgesFound[chain] > 100 || blocksAdded[chain] > BC_MAX_NEW_BLOCKS + 5) {
      savedReads[chain]++;
      if (failed[chain].low > height) failed[chain].low = height;
      if (failed[chain].high < height) failed[chain].high = height;
      continue;
    } else {
      const cached = edgesFound[chain] < 1;
      const opts = await persistence.getBlocksByHeight(height, chain, { asHeader: true, cached: true });
      if (opts && opts.length > 0) {
        if (loaded[chain].low > height) loaded[chain].low = height;
        if (loaded[chain].high < height) loaded[chain].high = height;
        // debugRover(`loaded block ${key}`)
        blocksAdded[chain]++;
        blocksFromDisk.push(opts);
      } else {
        // debugRover(`failed to load block ${key}`)
        if (failed[chain].low > height) failed[chain].low = height;
        if (failed[chain].high < height) failed[chain].high = height;
        edgesFound[chain]++;
      }
    }
  }

  const totalSavedReads = Object.keys(savedReads).reduce((n, chain) => {
    n = n + savedReads[chain];
    return n;
  }, 0);
  logger.info(`loaded ${blocksFromDisk.length} blocks from disk saving reads of ${totalSavedReads}`);
  debug(`loaded - ${inspect(loaded)}`);
  debug(`failed - ${inspect(failed)}`);
  debugRover(`loaded - ${inspect(loaded)}`);
  debugRover(`failed - ${inspect(failed)}`);

  if (!blocksFromDisk || blocksFromDisk.length < 1) {
    return Promise.reject(new Error(`Could not fetch current rovered block headers: ${newBlockHeadersKeys}`));
  }

  blocksFromDisk = unnest(blocksFromDisk);

  if (parseInt(lastPreviousBlock.getHeight(), 10) > 0) {
    const longestChainsTable = blocksFromDisk.reduce((obj, b) => {
      if (!b || !b.getBlockchain || !b.getHeight) {
        return obj;
      }

      let mounted = false;
      const chain = b.getBlockchain();
      const targetHash = b.getHash();
      const targetHeight = b.getHeight();
      const targetPrevHash = b.getPreviousHash();

      // debugRover(`beginning ${chain} review for ${targetHeight} target hash ${targetHash.slice(0, 8)} target prev hash ${targetPrevHash.slice(0, 8)}`)

      if (!obj[chain]) {
        obj[chain] = {};
      }

      if (Object.keys(obj[chain]).length === 0) {
        // add the target hash and start a new branch
        debugRover(`p0. first new branch created at mountpoint ${targetHash} block ${b.getHeight()}`);
        obj[chain][targetHash] = [[b]];
      } else {
        for (const mountPoint of Object.keys(obj[b.getBlockchain()])) {
          for (const [branchIndex, branch] of obj[chain][mountPoint].entries()) {
            for (const connectedBlock of branch) {
              if (connectedBlock.getHash() === targetPrevHash) {
                // determine if we need to open a new branch
                // debugRover(`p0. branch ${connectedBlock.getBlockchain()} index ${branchIndex} found block ${connectedBlock.getHeight()} to attach ${b.getHeight()}`)
                if (obj[chain][mountPoint][branchIndex][branch.length - 1].getHash() === targetPrevHash) {
                  // simply add the block
                  obj[chain][mountPoint][branchIndex].push(b);
                  // debugRover(`p0. added to mountpoint ${mountPoint.slice(0, 16)} branch with ${b.getBlockchain()} ${b.getHeight()}, ${obj[chain][mountPoint][branchIndex].length} blocks in branch`)
                  mounted = true;
                } else if (obj[chain][mountPoint][branchIndex][branch.length - 1].getHash() !== targetHash && obj[chain][mountPoint][branchIndex][branch.length - 1].getPreviousHash() === targetPrevHash) {
                  // } else {
                  // } else if (branch.length > 1) {
                  // create a new branch and remove the offending mount
                  const newBranch = branch.slice(0, -1);
                  newBranch.push(b);
                  // debugRover(`p0. created new branch from mountpoint ${mountPoint.slice(0, 16)} with ${b.getBlockchain()} ${b.getHeight()}, ${newBranch.length} blocks in branch`)
                  obj[chain][mountPoint].push(newBranch);
                  mounted = true;
                }
              }
            }
          }
        }
        // otherwise create it's own mount point
        if (!mounted) {
          // debugRover(`p0. created new branch from mountpoint ${b.getHash().slice(0, 16)} with  ${b.getHeight()}`)
          obj[chain][targetHash] = [[b]];
        }
      }
      return obj;
    }, {});

    let longestChains = Object.keys(longestChainsTable).reduce((all, chain) => {
      if (!chain) {
        debugRover(`table not found for chain: ${chain}`);
        return all;
      } else {
        debugRover(`p1. processing longest chains table for chain: ${chain}`);
      }
      const defaultMount = Object.keys(longestChainsTable[chain])[0]; // address
      const scores = Object.keys(longestChainsTable[chain]).reduce((s, mount) => {
        // longestChainsTable['eth']['o3riwef'][...branchs]
        for (let branch of Object.keys(longestChainsTable[chain][mount])) {
          const branchOption = longestChainsTable[chain][mount][branch];
          debugRover(`p2. processing longest chains for ${chain} @ ${mount}, branch length ${branchOption.length}, height: ${branchOption[0].getHeight()}`);
          s.push(branchOption.length);
        }
        return s;
      }, []);

      if (scores.length === 1) {
        const defaultList = longestChainsTable[chain][defaultMount][0];
        debugRover(`discovered longest ${chain} sequence of length ${defaultList.length}`);
        all.push(defaultList);
      } else if (parseInt(lastPreviousBlock.getHeight(), 10) === 1) {
        const defaultList = longestChainsTable[chain][defaultMount][0];
        debugRover(`discovered longest ${chain} sequence of length ${defaultList.length}`);
        all.push(defaultList);
      } else if (allEqual(scores)) {
        debugRover(`all ${chain} potential edges are equal`);
        const lastHeaderInPreviousBlock = last(lastPreviousBlock.getBlockchainHeaders()[chainToGet(chain)]());
        let found = false;
        for (let mountPoint of Object.keys(longestChainsTable[chain])) {
          for (let branch of longestChainsTable[chain][mountPoint]) {
            for (let blk of branch) {
              if (blk.getPreviousHash() === lastHeaderInPreviousBlock.getHash()) {
                debugRover(`all ${chain} potential edges are equal <- found mount at ${blk.getHeight()} ${blk.getPreviousHash().slice(0, 8)} ${blk.getHeight()}`);
                if (found) {
                  if (found.length < branch.length) {
                    found = branch;
                  }
                } else {
                  found = branch;
                }
              } else if (parseInt(lastHeaderInPreviousBlock.getHeight(), 10) === parseInt(blk.getHeight(), 10)) {
                debugRover(`all ${chain} potential edges are equal <- potential goldling mount at ${blk.getHeight()} HASH: ${blk.getHash().slice(0, 8)} PREV: ${blk.getPreviousHash().slice(0, 8)} ${blk.getHeight()}`);
                if (found) {
                  if (found.length < branch.length) {
                    found = branch;
                  }
                } else {
                  found = branch;
                }
              }
            }
          }
        }

        if (found) {
          all.push(found);
        } else if (!found) {
          debugRover(`no primary found sequence`);
          debugRover(longestChainsTable[chain][defaultMount][0]);
          all.push(longestChainsTable[chain][defaultMount][0]);
        }
      } else {
        const lastHeaderInPreviousBlock = last(lastPreviousBlock.getBlockchainHeaders()[chainToGet(chain)]());
        debugRover(`sorting available chain branchs for ${chain} ${Object.keys(longestChainsTable[chain]).length}`);
        // sort descending
        let best = false;
        for (let mountPoint of Object.keys(longestChainsTable[chain])) {
          for (let branch of longestChainsTable[chain][mountPoint]) {
            const bh = branch.length > 0 ? branch[0].getHeight() : '';
            debugRover(`sorting available chain branchs for ${chain} - ${mountPoint.slice(0, 16)} ${branch.length} height: ${bh}`);
            if (!best) {
              if (branch.length === 1 && branch[0].getHash() === lastHeaderInPreviousBlock.getHash()) {
                continue;
              }
              best = branch;
            } else {
              // branch root block must be lower or equal to current candidate and branch length must be longer
              if (best.length < branch.length && best[0].getHeight() >= branch[0].getHeight() || best[0].getHeight() > branch[0].getHeight() && branch.length > 1 || // branch can be lower and accepted but must have a length greater than 1
              best[0].getHeight() > branch[0].getHeight() && branch.length === 1 && branch[0].getHash() !== lastHeaderInPreviousBlock.getHash()) {
                // branch can have a length of 1 but must not equal the hash already in the chain
                debugRover(`branch is a height above ${chain} ${branch[0].getHeight()} - ${mountPoint.slice(0, 16)} ${branch.length}`);
                best = branch;
                // otherwise if branch is of a lower height or equal but has a lower root it is best (the new branch must be greater than 1)
              }
            }
          }
        }

        // select any chain even if it is one
        // if (!best && chainList.length > 0 && Object.keys(longestChainsTable[chain]).length > 0) {
        //  debugBestChain(`branch best is not found, selecting single mutation for ${chain}`)
        //  best = chainList.shift()
        // }

        if (!best) {
          debugRover(`unable to determine highest path forward discovered ${chain} from height ${lastHeaderInPreviousBlock.getHeight()}`);
          debugBestChain(`unable to determine highest path forward discovered ${chain}`);
        } else {
          best = best.sort((a, b) => {
            if (parseInt(a.getHeight(), 10) > parseInt(b.getHeight(), 10)) {
              return 1;
            }
            if (parseInt(a.getHeight(), 10) < parseInt(b.getHeight(), 10)) {
              return -1;
            }
            return 0;
          });
          debugRover(`highest path forward discovered ${chain} is ${best.length} blocks, mount: ${best[0].getHeight()}`);
          debugBestChain(`highest path forward discovered ${chain} is ${best.length} blocks, mount: ${best[0].getHeight()}`);
          all = all.concat(best);
        }
      }
      return all;
    }, []);

    blocksFromDisk = unnest(longestChains);
  }

  /*
     * Sorted Goldling supported blocks for miner
     */
  const register = {};
  const goldlings = [];

  for (const [i, block] of blocksFromDisk.entries()) {
    // const bestChain = blocksFromDisk.reduce(async (all, block, i) => {

    if (!block) {
      debugRover('<--------------------------------- edge');
      continue;
    }

    ///
    // debugRover(`\n---------------------------${block.getBlockchain()} ${block.getHeight()} hash: ${block.getHash().slice(0, 8)} prev: ${block.getPreviousHash().slice(0, 8)}-----------------------------------`)

    let nextBlock = false;
    let previousBlock = false;
    const bc = block.getBlockchain();

    if (!register[bc]) {
      register[bc] = 1;
    } else {
      register[bc]++;
    }

    if (finalBlocks.length > 0 && finalBlocks[finalBlocks.length - 1].getBlockchain() === block.getBlockchain()) {
      // a block of the second blockchain follows this block
      previousBlock = finalBlocks[finalBlocks.length - 1];
      // debugRover(`previous block is available ${previousBlock.getHeight()} : ${previousBlock.getHash().slice(0, 8)}`)
    }

    if (blocksFromDisk[i + 1] && blocksFromDisk[i + 1].getBlockchain() === block.getBlockchain()) {
      nextBlock = blocksFromDisk[i + 1];
      // debugRover(`next block is available ${nextBlock.getHeight()}, HASH:  ${nextBlock.getHash().slice(0, 8)} PREV: ${nextBlock.getPreviousHash().slice(0, 8)}`)
    }

    if (lastPreviousBlock.getHeight() < 2 && finalBlocks.length < 1) {
      // this sequence of blocks builds on a genesis block
      // debugRover(`building on genesis block with ${block.getHeight()}, HASH: ${block.getHash().slice(0, 8)} PREV: ${block.getPreviousHash().slice(0, 8)}`)
      finalBlocks.push(block);
      continue;
      // return all
    } else if (lastPreviousBlock.getHeight() < 2 && finalBlocks.length > 0 && finalBlocks[finalBlocks.length - 1].getBlockchain() !== block.getBlockchain()) {
      // debugRover(`building on genesis block with ${block.getHeight()}, HASH: ${block.getHash().slice(0, 8)} PREV: ${block.getPreviousHash().slice(0, 8)}`)
      if (register[bc] < BC_MAX_NEW_BLOCKS) {
        finalBlocks.push(block);
      }
      continue;
      // return finalBlocks
    }

    // last block header available in the blockchain unless this is built on genesis block
    const lastHeaderInPreviousBlock = parseInt(lastPreviousBlock.getHeight(), 10) < 2 ? finalBlocks[finalBlocks.length - 1] : last(lastPreviousBlock.getBlockchainHeaders()[chainToGet(block.getBlockchain())]());
    if (!lastHeaderInPreviousBlock) {
      debugRover('header not found in previous block');
      if (register[bc] < BC_MAX_NEW_BLOCKS) {
        finalBlocks.push(block);
      }
      continue;
      // return finalBlocks
    }
    // debugRover(`last header in previous block ${lastHeaderInPreviousBlock.getHeight()}, HASH: ${lastHeaderInPreviousBlock.getHash().slice(0, 8)} PREV: ${lastHeaderInPreviousBlock.getPreviousHash().slice(0, 8)}`)

    // block matches block already in blockchain
    if (nextBlock && nextBlock.getPreviousHash() === block.getHash() && lastHeaderInPreviousBlock.getPreviousHash() === block.getPreviousHash() && lastHeaderInPreviousBlock.getHash() === block.getHash() && lastHeaderInPreviousBlock.getHeight() === block.getHeight()) {
      debugRover(`- ${block.getBlockchain()} block ${block.getHeight()} HASH: ${block.getHash().slice(0, 8)} PREV: ${block.getPreviousHash()} matches the block already in the chain and there are more blocks to come`);
      continue;
      // return finalBlocks
    }

    // possibly add Goldling to branch which prevents futures children and matches the block already on chain
    if (lastHeaderInPreviousBlock.getPreviousHash() === block.getPreviousHash() && lastHeaderInPreviousBlock.getHash() !== block.getHash() && nextBlock && nextBlock.getPreviousHash() === block.getHash()) {
      debugRover(`+ ${block.getBlockchain()} block ${block.getHeight()} HASH: ${block.getHash().slice(0, 8)} PREV: ${block.getPreviousHash().slice(0, 8)} adding as initial Goldling`);
      if (register[bc] < BC_MAX_NEW_BLOCKS) {
        finalBlocks.push(block);
      }
      continue;
      // return finalBlocks
    }

    // block represents a disconnect in the chain where both the hash and the previous hash do not match forming a goldling
    if (lastHeaderInPreviousBlock.getPreviousHash() !== block.getPreviousHash() && lastHeaderInPreviousBlock.getHash() !== block.getHash() && lastHeaderInPreviousBlock.getHeight() === block.getHeight() && nextBlock && nextBlock.getPreviousHash() === block.getHash()) {
      const earlyHeaders = await persistence.getRootedBlockFromBlock(block, []);
      if (register[bc] < BC_MAX_NEW_BLOCKS) {
        finalBlocks.push(block);
      }
      // place the early headers at the front
      if (earlyHeaders) {
        debugRover(`+ ${block.getBlockchain()} added ${earlyHeaders.length} with ${block.getHeight()} HASH: ${block.getHash().slice(0, 8)} PREV: ${block.getPreviousHash().slice(0, 8)} adding bridging goldlings`);
        finalBlocks = earlyHeaders.concat(finalBlocks);
        continue;
      } else {
        debugRover(`+ ${block.getBlockchain()} unable to find headers block ${block.getHeight()} HASH: ${block.getHash().slice(0, 8)} PREV: ${block.getPreviousHash().slice(0, 8)} adding but cannot bridge goldlings`);
        const diff = parseInt(block.getHeight(), 10) - parseInt(lastHeaderInPreviousBlock.getHeight(), 10);
        if (!missingBlocks[block.getBlockchain()]) {
          missingBlocks[block.getBlockchain()] = {
            highest: parseInt(block.getHeight(), 10),
            lowest: parseInt(lastHeaderInPreviousBlock.getHeight(), 10) - 8
          };
        } else {
          // only update lowest
          if (missingBlocks[block.getBlockchain()].lowest > parseInt(block.getHeight(), 10)) {
            missingBlocks[block.getBlockchain()].lowest = parseInt(block.getHeight(), 10);
          }
        }
      }
      // return finalBlocks
      continue;
    }

    // putChildBlocksIndexFromBlock
    // Goldling situation encountered stop adding blocks to this sequence
    if (previousBlock && previousBlock.getPreviousHash() === lastHeaderInPreviousBlock.getPreviousHash() && previousBlock.getHash() === block.getPreviousHash() && previousBlock.getHash() !== lastHeaderInPreviousBlock.getHash()) {
      debugRover(`- ${block.getBlockchain()} block ${block.getHeight()} HASH: ${block.getHash().slice(0, 8)} PREV: ${block.getPreviousHash().slice(0, 8)} NOT ADDING as GOLDLING detected`);
      debug(`- ${block.getBlockchain()} block ${block.getHeight()} HASH: ${block.getHash().slice(0, 8)} PREV: ${block.getPreviousHash().slice(0, 8)} NOT ADDING as GOLDLING detected`);
      if (goldlings.indexOf(block.getBlockchain()) < 0) {
        goldlings.push(block.getBlockchain());
      }
      // if (finalBlocks.length < 32) {
      //  debugRover(`- block ${block.getHeight()} HASH: ${block.getHash().slice(0, 8)} PREV: ${block.getPreviousHash().slice(0, 8)} ADDING to GOLDLING detected`)
      //  finalBlocks.push(block)
      // }
      continue;
      // return finalBlocks
    }

    // only one child and matching the current block
    if (!nextBlock && !previousBlock && block.getHash() === lastHeaderInPreviousBlock.getHash() && block.getPreviousHash() === lastHeaderInPreviousBlock.getPreviousHash()) {
      // finalBlocks.push(block)
      debugRover(`- ${block.getBlockchain()} block ${block.getHeight()} HASH: ${block.getHash().slice(0, 8)} PREV: ${block.getPreviousHash().slice(0, 8)} already in chain and one child so not adding`);
      // here evaluate the latest block height and potentifinalBlocks add it to missing

      const roverChain = block.getBlockchain();
      const latestRoverBlock = await persistence.get(`${block.getBlockchain()}.block.latest`);
      if (latestRoverBlock && latestRoverBlock.getHeight() > block.getHeight()) {
        if (!missingBlocks[roverChain]) {
          missingBlocks[roverChain] = {
            highest: min(parseInt(block.getHeight(), 10) + BC_MAX_NEW_BLOCKS * 10, parseInt(latestRoverBlock.getHeight(), 10)),
            lowest: parseInt(block.getHeight(), 10) - 6
          };
        } else {
          if (missingBlocks[roverChain].lowest > parseInt(block.getHeight(), 10)) {
            missingBlocks[roverChain].lowest = parseInt(block.getHeight(), 10) - 1;
          }
          if (missingBlocks[roverChain].highest < parseInt(latestRoverBlock.getHeight(), 10)) {
            missingBlocks[roverChain].highest = min(parseInt(block.getHeight(), 10) + BC_MAX_NEW_BLOCKS * 10, parseInt(latestRoverBlock.getHeight(), 10));
          }
        }
      }
      continue;
      // return finalBlocks
    }

    // more children coming and matches block header in previous blockchain so ignored
    if (nextBlock && nextBlock.getPreviousHash() === block.getHash() && block.getHash() === lastHeaderInPreviousBlock.getHash() && block.getPreviousHash() === lastHeaderInPreviousBlock.getPreviousHash()) {
      debugRover(`- ${block.getBlockchain()} block ${block.getHeight()} HASH: ${block.getHash().slice(0, 8)} PREV: ${block.getPreviousHash().slice(0, 8)} already in blockchain and part of upcoming sequence `);
      continue;
      // return finalBlocks
    }

    // new block extends blockchain from block already in chain
    if (previousBlock && block.getPreviousHash() === previousBlock.getHash()) {
      debugRover(`+ ${block.getBlockchain()} block ${block.getHeight()} HASH: ${block.getHash().slice(0, 8)} PREV: ${block.getPreviousHash().slice(0, 8)} extends blockchain sequence`);

      if (register[bc] < BC_MAX_NEW_BLOCKS) {
        finalBlocks.push(block);
      }
      continue;
      // return finalBlocks
    }

    // new block extends blockchain from block already in chain
    if (!previousBlock && lastHeaderInPreviousBlock.getHash() === block.getPreviousHash()) {
      // if there is a next block of a different height push it is a goldling
      if (nextBlock && nextBlock.getHeight() === block.getHeight() && nextBlock.getPreviousHash() === lastHeaderInPreviousBlock.getHash()) {
        debugRover(`- ${block.getBlockchain()} block ${block.getHeight()} HASH: ${block.getHash().slice(0, 8)} PREV: ${block.getPreviousHash().slice(0, 8)} blocking the for a potential Goldling`);
      } else {
        debugRover(`+ ${block.getBlockchain()} block ${block.getHeight()} HASH: ${block.getHash().slice(0, 8)} PREV: ${block.getPreviousHash().slice(0, 8)} extends last header as new child header block`);
        if (register[bc] < BC_MAX_NEW_BLOCKS) {
          finalBlocks.push(block);
        }
      }
      // return finalBlocks
      continue;
    }

    const diff = parseInt(block.getHeight(), 10) - parseInt(lastHeaderInPreviousBlock.getHeight(), 10);
    if (!missingBlocks[block.getBlockchain()]) {
      missingBlocks[block.getBlockchain()] = {
        highest: parseInt(block.getHeight(), 10),
        lowest: parseInt(lastHeaderInPreviousBlock.getHeight(), 10) - 6
      };
    } else {
      if (missingBlocks[block.getBlockchain()].lowest > parseInt(block.getHeight(), 10)) {
        missingBlocks[block.getBlockchain()].lowest = parseInt(block.getHeight(), 10);
      }
      if (missingBlocks[block.getBlockchain()].highest < parseInt(block.getHeight(), 10)) {
        missingBlocks[block.getBlockchain()].highest = parseInt(block.getHeight(), 10);
      }
    }

    debugRover(`unable to process <-- block ${block.getHeight()} HASH: ${block.getHash().slice(0, 32)} PREV: ${block.getPreviousHash().slice(0, 32)} where last header in previous block is ${block.getBlockchain()} ${lastHeaderInPreviousBlock.getHeight()} : ${lastHeaderInPreviousBlock.getHash().slice(0, 8)} `);
    // return finalBlocks
  }

  // remove block missing requests for goldlings
  debugRover(`${goldlings.length} Goldlings found in the following connected chains: ${goldlings}`);
  for (let g of goldlings) {
    delete missingBlocks[g];
  }

  Object.keys(missingBlocks).map(chain => {
    debugRover(`${chain} missing blocks is ${missingBlocks[chain].lowest} -> ${missingBlocks[chain].highest}`);
  });
  debugRover(`bestChain length is ${finalBlocks.length}`);
  debugBestChain(`bestChain length is ${finalBlocks.length}`);
  return Promise.resolve({ bestChain: finalBlocks, missingBlocks: missingBlocks });
};