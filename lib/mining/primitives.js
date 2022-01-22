'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getExpFactorDiff = getExpFactorDiff;
exports.getDiff = getDiff;
exports.createMerkleRoot = createMerkleRoot;
exports.split = split;
exports.dist = dist;
exports.distance = distance;
exports.distanceFromCache = distanceFromCache;
exports.overlineDistance = overlineDistance;
exports.mine = mine;
exports.getNewestHeaderReverse = getNewestHeaderReverse;
exports.getNewestHeader = getNewestHeader;
exports.getParentShareDiff = getParentShareDiff;
exports.getMinimumDifficulty = getMinimumDifficulty;
exports.getNewPreExpDifficulty = getNewPreExpDifficulty;
exports.prepareWork = prepareWork;
exports.getNewBlockCount = getNewBlockCount;
exports.getChildBlockDiff = getChildBlockDiff;
exports.getUniqueHashes = getUniqueHashes;
exports.getUniqueBlocks = getUniqueBlocks;
/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * TODO: Fix flow issues
 * 
 */

/**
 *    DOCUMENT IN FOUR PARTS
 *
 *      PART 1: Difficulty of the next block [COMPLETE]
 *
 *      PART 2: Mining a block hash [COMPLETE]
 *
 *      PART 3: Blockchain header proofs [IN PROGRESS]
 *
 *      PART 4: Create Block Collider Block Hash  [COMPLETE]
 *
 */

const Fiber = require('fibers');
const { inspect } = require('util');
const similarity = require('compute-cosine-similarity');
const BN = require('bn.js');
const Random = require('random-js');
const {
  difference,
  groupBy,
  invoker,
  isEmpty,
  last,
  max,
  min,
  map,
  equals,
  // $FlowFixMe - missing in ramda flow-typed annotation
  partialRight,
  reduce,
  reverse,
  splitEvery,
  toPairs,
  zip,
  any
} = require('ramda');
const debug = require('debug')('bcnode:mining:primitives');

const { blake2bl } = require('../utils/crypto');
const { concatAll } = require('../utils/ramda');
const { Block, BcBlock, MarkedTransaction, Transaction, BlockchainHeader, BlockchainHeaders } = require('@overline/proto/proto/core_pb');
const ts = require('../utils/time').default; // ES6 default export
const GENESIS_DATA = require('../bc/genesis.raw');
const BC_BUILD_GENESIS = process.env.BC_BUILD_GENESIS === 'true';

const abs = value => {
  return value < 0 ? -value : value;
};

class MineBig {
  constructor(value) {
    let [ints, decis] = String(value).split(".").concat("");
    decis = decis.padEnd(MineBig.decimals, "0");
    this.bigint = BigInt(ints + decis);
  }
  static fromBigInt(bigint) {
    return Object.assign(Object.create(MineBig.prototype), { bigint });
  }
  divide(divisor) {
    // You would need to provide methods for other operations
    return MineBig.fromBigInt(this.bigint * BigInt("1" + "0".repeat(MineBig.decimals)) / divisor.bigint);
  }
  toString() {
    const s = this.bigint.toString();
    return s.slice(0, -MineBig.decimals) + "." + s.slice(-MineBig.decimals).replace(/\.?0+$/, "");
  }
}

MineBig.decimals = 18; // Configuration of the number of decimals you want to have.


// testnet: 11801972029393
const BC_MINIMUM_DIFFICULTY = exports.BC_MINIMUM_DIFFICULTY = !isNaN(process.env.BC_MINIMUM_DIFFICULTY) ? BigInt(process.env.BC_MINIMUM_DIFFICULTY) : BigInt(200012262029662);
const MAX_TIMEOUT_SECONDS = 45;

const logging = require('../logger');
const logger = logging.getLogger(__filename);

/// /////////////////////////////////////////////////////////////////////
/// ////////////////////////
/// ////////////////////////  PART 1  - Dificulty of the next block
/// ////////////////////////
/// /////////////////////////////////////////////////////////////////////

/**
 * Determines the singularity height and difficulty
 *
 * @param calculatedDifficulty
 * @param parentBlockHeight
 * @returns a
 */
function getExpFactorDiff(calculatedDifficulty, parentBlockHeight) {
  const big1 = new BN(1);
  const big2 = new BN(2);
  const expDiffPeriod = new BN(66000000);

  // periodCount = (parentBlockHeight + 1) / 66000000
  let periodCount = new BN(parentBlockHeight).add(big1);
  periodCount = periodCount.div(expDiffPeriod);

  // if (periodCount > 2)
  if (periodCount.gt(big2) === true) {
    // return calculatedDifficulty + (2 ^ (periodCount - 2))
    let y = periodCount.sub(big2);
    y = big2.pow(y);
    calculatedDifficulty = calculatedDifficulty.add(y);
    return calculatedDifficulty;
  }
  return calculatedDifficulty;
}
/**
 * FUNCTION: getDiff(t)
 *   Gets the difficulty of a given blockchain without singularity calculation
 *
 * @param currentBlockTime
 * @param previousBlockTime
 * @param previousDifficulty
 * @param minimalDifficulty
 * @param newBlockCount
 * @returns
 */
function getDiff(currentBlockTime, previousBlockTime, previousDifficulty, minimalDifficulty, newBlockCount, newestChildHeader) {

  const bigBcMinimumDifficulty = BC_MINIMUM_DIFFICULTY;
  let bigMinimalDifficulty = BigInt(minimalDifficulty);
  bigMinimalDifficulty = bigMinimalDifficulty < bigBcMinimumDifficulty ? bigBcMinimumDifficulty : bigMinimalDifficulty;
  let newestChildBlock = newestChildHeader;
  if (newBlockCount === undefined) {
    throw new Error('new block count is not defined');
    // return false
  }

  // logger.info('\n\n\n\n------- CHILD HEADER --------\n')
  debug(newestChildHeader);

  function log(msg) {
    if (process.title.indexOf('bc-main') > -1) {
      console.log(msg);
    }
  }

  let bigPreviousDifficulty = BigInt(previousDifficulty);
  const bigPreviousBlockTime = BigInt(previousBlockTime);
  const bigCurrentBlockTime = BigInt(currentBlockTime);
  const bigMinus99 = BigInt(-99);
  const big1 = BigInt(1);
  const big0 = BigInt(0);
  const bigTargetTimeWindow = BigInt(8); // <-- AT // ASSERT
  let timestamp = 0;
  if (newestChildBlock.timestamp === undefined) {
    if (newestChildBlock.toObject) {
      newestChildBlock = newestChildHeader.toObject();
      timestamp = newestChildBlock.timestamp;
    } else {
      timestamp = Number(currentBlockTime) - 6;
    }
  } else {
    timestamp = newestChildBlock.timestamp;
  }
  let bigChildHeaderTime = BigInt(timestamp) / BigInt(1000);
  if (bigChildHeaderTime < bigPreviousBlockTime) {
    bigChildHeaderTime = bigPreviousBlockTime;
  }
  let bigChildHeaderTimeBound = bigChildHeaderTime + bigTargetTimeWindow * BigInt(2);
  let elapsedTime = bigCurrentBlockTime - bigPreviousBlockTime;

  if (BC_BUILD_GENESIS && elapsedTime > BigInt(6000)) {
    elapsedTime = BigInt(3);
    bigPreviousDifficulty = BigInt(290112262029012);
  }

  // rescue block made 05/25/2020
  if (previousBlockTime === 1587132412 || previousBlockTime === 1587132449) {
    return 298678954710059;
  }
  if (previousBlockTime === 1590157894 || previousBlockTime === 1590132950) {
    return 291678954710059;
  }
  if (previousBlockTime === 1590283479) {
    return 291678954710059;
  }
  if (previousBlockTime === 1590337524) {
    return 291678954710059;
  }
  if (previousBlockTime === 1591666381) {
    return 291678954710059;
  }
  if (previousBlockTime === 1596864102) {
    return 291678954710059;
  }
  if (previousBlockTime === 1597558249) {
    return 291678954710059;
  }
  if (previousBlockTime === 1625431234) {
    return 311678954710059;
  }

  let staleCost = (bigCurrentBlockTime - bigChildHeaderTimeBound) / bigTargetTimeWindow;
  let staleWeight = 10;

  if (staleCost > big0) {
    const elapsedTimeHold = elapsedTime - BigInt(staleCost);

    // update for OT mine
    if (previousBlockTime <= 1591666380) {
      elapsedTime = elapsedTimeHold;
    }
  }

  if (previousBlockTime > 1640266692 && elapsedTime > BigInt(36) && BigInt(newBlockCount) > BigInt(1)) {
    if (previousBlockTime > 1644536250 && elapsedTime > BigInt(86) && BigInt(newBlockCount) > BigInt(1)) {
      elapsedTime = elapsedTime * BigInt(newBlockCount);
    } else if (previousBlockTime < 1642981050) {
      elapsedTime = elapsedTime * BigInt(newBlockCount);
    }
  }

  let elapsedTimeBonus = elapsedTime + (elapsedTime - BigInt(staleWeight) + BigInt(newBlockCount));

  debug('time bonus  ' + Number(elapsedTimeBonus));
  elapsedTime = elapsedTimeBonus;

  // x = 1 - floor(x / handicap)
  let x = big1 - elapsedTime / bigTargetTimeWindow; // div floors by default
  let y;
  let n;

  // x < -99 ? -99 : x
  if (BigInt(x) < bigMinus99) {
    x = bigMinus99;
  }

  if (previousBlockTime > 1644536250) {

    if (x < big0) {
      n = BigInt(1615500) + elapsedTimeBonus; // <-- AT2
    } else {
      n = BigInt(1506600) + elapsedTimeBonus; // <-- AT2
    }
  } else {
    // y = bigPreviousDifficulty -> OVERLINE: 10062600 // AT: 1615520 // BT: ((32 * 16) / 2PI ) * 10 = 815 chain count + hidden chain = 508
    if (x < big0) {
      // n = BigInt(1615520) + elapsedTimeBonus // <-- BT
      n = BigInt(16155) + elapsedTimeBonus; // <-- AT
    } else {
      // n = BigInt(1506600) + elapsedTimeBonus <-- BT
      n = BigInt(15066) + elapsedTimeBonus; // <-- AT
    }
  }

  y = bigPreviousDifficulty / n;
  // x = x * y
  x = x * BigInt(y);
  // x = x + previousDifficulty
  x = x + bigPreviousDifficulty + elapsedTimeBonus;

  debug('');
  debug('----------------------------- bigChildHeaderTime: ' + bigChildHeaderTime);
  debug('----------------------------- bigChildHeaderTimeBound: ' + bigChildHeaderTimeBound);
  debug('----------------------------- currentBlockTime: ' + currentBlockTime);
  debug('----------------------------- previousBlockTime: ' + previousBlockTime);
  debug('----------------------------- newBlockCount: ' + newBlockCount);
  debug('----------------------------- bigPreviousDifficulty: ' + bigPreviousDifficulty);
  debug('----------------------------- staleCost: ' + staleCost);
  debug('----------------------------- bigChildHeaderTime: ' + bigChildHeaderTime);
  debug('----------------------------- elapsedTime: ' + elapsedTime);
  debug('----------------------------- elapsedTimeBonus: ' + elapsedTimeBonus);
  debug('----------------------------- n: ' + n);
  debug('----------------------------- x: ' + x);
  debug('----------------------------- y: ' + y);
  debug('');

  if (x < BigInt(BC_MINIMUM_DIFFICULTY)) {
    return BC_MINIMUM_DIFFICULTY;
  }

  // x < minimalDifficulty
  if (x < bigMinimalDifficulty) {
    return minimalDifficulty;
  }

  return Number(x);
}

function createMerkleRoot(list) {
  debug(`createMerkleRoot() list lenght: ${list.length}`);

  let merkleRoot;
  for (const part of list) {
    if (merkleRoot !== undefined) {
      merkleRoot = blake2bl(merkleRoot + part);
    } else {
      merkleRoot = blake2bl(part);
    }
  }

  return merkleRoot;
}

/// /////////////////////////////////////////////////////////////////////
/// ////////////////////////
/// ////////////////////////  PART 2 - Mining a Block
/// ////////////////////////
/// /////////////////////////////////////////////////////////////////////

/**
 * The Blake2BL hash of the proof of a block
 */
// const blockProofs = [
//   '9b80fc5cba6238801d745ca139ec639924d27ed004c22609d6d9409f1221b8ce', // BTC
//   '781ff33f4d7d36b3f599d8125fd74ed37e2a1564ddc3f06fb22e1b0bf668a4f7', // ETH
//   'e0f0d5bc8d1fd6d98fc6d1487a2d59b5ed406940cbd33f2f5f065a2594ff4c48', // LSK
//   'ef631e3582896d9eb9c9477fb09bf8d189afd9bae8f5a577c2107fd0760b022e', // WAV
//   'e2d5d4f3536cdfa49953fb4a96aa3b4a64fd40c157f1b3c69fb84b3e1693feb0', // NEO
//   '1f591769bc88e2307d207fc4ee5d519cd3c03e365fa16bf5f63f449b46d6cdef' // EMB (Block Collider)
// ]

/**
 *  Converts characters of string into ASCII codes
 *
 * @returns {Number|Array}
 */
function split(t) {
  return t.split('').map(function (an) {
    return an.charCodeAt(0);
  });
}

/**
 * Converts cosine similary to cos distance
 */
function dist(x, y, clbk) {
  let s;
  if (arguments.length > 2) {
    s = similarity(x, y, clbk);
  } else {
    s = similarity(x, y);
  }
  return s !== null ? 1 - s : s;
}

/**
 * [DEPRICATED] Returns summed distances between two strings broken into of 8 bits
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} cosine distance between two strings
 */
function distance(a, b) {
  const aChunks = reverse(splitEvery(32, split(a)));
  const bChunks = splitEvery(32, split(b));
  const chunks = zip(aChunks, bChunks);

  const value = chunks.reduce(function (all, [a, b]) {
    return all + dist(b, a);
  }, 0);

  // TODO this is the previous implementation - because of
  // ac.pop() we need to reverse(aChunks) to produce same number
  // is that correct or just side-effect?
  // const value = bc.reduce(function (all, bd, i) {
  //   return all + dist(bd, ac.pop())
  // }, 0)
  return Math.floor(value * 1000000000000000); // TODO: Move to safe MATH
}

/**
 * Returns distances between string chunks and a string proposed by @lgray
 * @returns {number} cosine distance between two strings
 */
function distanceFromCache(aChunks, b) {
  // const aChunks = reverse(splitEvery(32, split(a)))
  const bChunks = split(b);

  const bchunkslength = Math.ceil(bChunks.length / 32);
  let value = 0;
  const len = Math.min(aChunks.length, bchunkslength);
  for (var i = 0; i < len; i++) {
    const tail = Math.min(32 * (i + 1), bChunks.length);
    value += dist(bChunks.slice(32 * i, tail), aChunks[i]);
  }

  return Math.floor(value * 1000000000000000);
}

function overlineDistance(a, b) {
  let value = dist(split(a).sort(), split(b).sort());
  return Math.floor(value * 1000000000000000);
}

/**
 * Finds the mean of the distances from a provided set of hashed header proofs
 *
 * @param {number} currentTimestamp current time reference
 * @param {string} work reference to find distance > `threshold`
 * @param {string} miner Public address to which NRG award for mining the block and transactions will be credited to
 * @param {string} merkleRoot Mekle root of the BC block being mined
 * @param {number} threshold threshold for the result to be valid
 * @param {function} difficultyCalculator function for recalculating difficulty at given timestamp
 * @returns {Object} result containing found `nonce` and `distance` where distance is > `threshold` provided as parameter
 */
// $FlowFixMe will never return anything else then a mining result
function mine(currentTimestamp, work, miner, merkleRoot, threshold, difficultyCalculator, emitter, sampleData = false) {
  let difficulty = threshold;
  let difficultyBI = BigInt(difficulty) < BC_MINIMUM_DIFFICULTY && !sampleData ? BC_MINIMUM_DIFFICULTY : BigInt(difficulty);
  let result = 0;
  const tsStart = ts.now();
  const workChunks = reverse(splitEvery(32, split(work)));
  let currentLoopTimestamp = currentTimestamp;
  let iterations = 0;
  let res = null;
  let nowms = 0;
  let now = 0;
  let startFingerprint = false;

  const inc = Fiber(e => {

    while (true) {
      iterations += 1;

      nowms = ts.now();
      now = nowms / 1000 << 0;
      const nonce = String(abs(Random.engines.nativeMath()));
      const nonceHash = blake2bl(nonce);
      result = distanceFromCache(workChunks, blake2bl(miner + merkleRoot + nonceHash + currentLoopTimestamp));

      if (BigInt(result) > difficultyBI) {
        res = {
          distance: result.toString(),
          nonce,
          timestamp: currentLoopTimestamp,
          difficulty,
          iterations,
          timeDiff: nowms - tsStart
        };
        e.emit('solution', res);
        Fiber.yield(1);
        break;
      }

      if (now >= currentTimestamp + 40) {
        res = {
          iterations,
          timeDiff: nowms - tsStart
        };
        process.exit();
        e.emit('solution', res);
        Fiber.yield(1);
        break;
      }

      if (sampleData && iterations > 100) {
        res = {
          iterations,
          timeDiff: nowms - tsStart
        };
        e.emit('solution', res);
        Fiber.yield(1);
        break;
      }

      // recalculate difficulty each second
      if (difficultyCalculator && currentLoopTimestamp < now) {
        currentLoopTimestamp = now;
        difficulty = difficultyCalculator(now);
        difficultyBI = BigInt(difficulty);
      }
      Fiber.yield(0);
    }
  });

  // MM: Migrate this to socket or eval directly in for loop
  for (let ii = inc.run(emitter); ii < 1; ii = inc.run(emitter)) {
    //emitter.emit('data', iterations)
  }

  return emitter;
}

function getNewestHeaderReverse(newBlock) {

  let headers = null;
  if (newBlock === undefined) {
    logger.warn('failed: getHeight new block could not be found');
    return false;
  }
  if (newBlock && newBlock.getBtcList) {
    headers = newBlock.toObject();
  } else {
    // logger.info('getting block height ' + newBlock.getHeight())
    if (newBlock.getBlockchainHeaders === undefined) {
      logger.warn('failed: getHeight new block could not be found');
      return false;
    }
    headers = newBlock.getBlockchainHeaders().toObject();
  }

  logger.debug(`evaluating headers: ${Object.keys(headers).length}`);

  const newestHeader = Object.keys(headers).reduce((newest, key) => {
    const sorted = headers[key].sort((a, b) => {
      if (new BN(a.timestamp).gt(new BN(b.timestamp)) === true) {
        return -1;
      }
      if (new BN(a.timestamp).lt(new BN(b.timestamp)) === true) {
        return 1;
      }
      if (new BN(a.timestamp).eq(new BN(b.timestamp)) === true) {
        if (new BN(a.height).gt(new BN(b.height)) === true) {
          return -1;
        }
        if (new BN(a.height).lt(new BN(b.height)) === true) {
          return 1;
        }
      }
      return 0;
    });

    const header = sorted.pop();

    if (!newest) {
      newest = header;
    } else if (header && header.timestamp) {
      if (newest && newest.timestamp && new BN(newest.timestamp).lt(new BN(header.timestamp))) {
        newest = header;
      } else {
        newest = header;
      }
    }
    return newest;
  }, false);

  if (newestHeader === false) {
    return false;
  }

  return newestHeader;
}

function getNewestHeader(newBlock) {

  let headers = null;
  if (newBlock === undefined) {
    logger.warn('failed: getHeight new block could not be found');
    return false;
  }
  if (newBlock && newBlock.getBtcList) {
    headers = newBlock.toObject();
  } else {
    // logger.info('getting block height ' + newBlock.getHeight())
    if (newBlock.getBlockchainHeaders === undefined) {
      logger.warn('failed: getHeight new block could not be found');
      return false;
    }
    headers = newBlock.getBlockchainHeaders().toObject();
  }

  logger.debug(`evaluating headers: ${Object.keys(headers).length}`);

  const newestHeader = Object.keys(headers).reduce((newest, key) => {
    const sorted = headers[key].sort((a, b) => {
      if (new BN(a.timestamp).gt(new BN(b.timestamp)) === true) {
        return 1;
      }
      if (new BN(a.timestamp).lt(new BN(b.timestamp)) === true) {
        return -1;
      }
      if (new BN(a.timestamp).eq(new BN(b.timestamp)) === true) {
        if (new BN(a.height).gt(new BN(b.height)) === true) {
          return 1;
        }
        if (new BN(a.height).lt(new BN(b.height)) === true) {
          return -1;
        }
      }
      return 0;
    });

    const header = sorted.pop();

    if (newest === false) {
      newest = header;
    } else if (header && header.timestamp) {
      if (newest && newest.timestamp && new BN(newest.timestamp).lt(new BN(header.timestamp))) {
        newest = header;
      } else {
        newest = header;
      }
    }
    return newest;
  }, false);

  if (newestHeader === false) {
    return false;
  }

  return newestHeader;
}

/// /////////////////////////////////////////////////////////////////////
/// ////////////////////////
/// ////////////////////////  PART 3 - Blockchain Header Proofs
/// ////////////////////////
/// /////////////////////////////////////////////////////////////////////

/*
 * It will look like this:
 *
 *      function createBlockProof(blockchainFingerprint, rawBlock, callback)
 *
 * Where the fingerprint for Ethereum is "bbe5c469c469cec1f8c0b01de640df724f3d9053c23b19c6ed1bc6ee0faf5160"
 * as seen in bcnode/src/utils/templates/blockchain_fingerprints.json
 *
 */
const toHexBuffer = partialRight(invoker(2, 'from'), ['hex', Buffer]);
const hash = invoker(0, 'getHash');
const merkleRoot = invoker(0, 'getMerkleRoot');

const markedTransactionHash = exports.markedTransactionHash = tTx => {
  const payload = `${tTx.getId()}${tTx.getToken()}${tTx.getAddrFrom()}${tTx.getAddrTo()}${tTx.getValue()}`;
  return blake2bl(payload);
};

/**
 * Computes hash form a rovered block header as blake2bl(hash + mekleRoot)
 * @param {BlockchainHeader|Block} block to hash
 * @return {string} hash of the block
 */
const blockHash = exports.blockHash = roveredBlockLike => {
  let payload = roveredBlockLike.getHash() + roveredBlockLike.getMerkleRoot();
  if (!isEmpty(roveredBlockLike.getMarkedTxsList())) {
    for (const tTx of roveredBlockLike.getMarkedTxsList()) {
      payload += `${markedTransactionHash(tTx)}`;
    }
  }
  return blake2bl(payload);
};

const getChildrenBlocksHashes = exports.getChildrenBlocksHashes = map(blockHash);

const blockchainMapToList = exports.blockchainMapToList = headersMap => {
  return Object.keys(headersMap.toObject()).sort().map(listName => {
    const getMethodName = `get${listName[0].toUpperCase()}${listName.slice(1)}`;
    return headersMap[getMethodName]();
  }).reduce((acc, curr) => {
    return acc.concat(curr);
  }, []);
};

const getChildrenRootHash = exports.getChildrenRootHash = reduce((all, blockHash) => {
  return all.xor(new BN(toHexBuffer(blockHash)));
}, new BN(0));

function getParentShareDiff(parentDifficulty, childChainCount) {
  return parentDifficulty / childChainCount;
}

function getMinimumDifficulty(childChainCount) {
  // Standard deviation 100M cycles divided by the number of chains
  return BC_MINIMUM_DIFFICULTY / childChainCount;
}

// TODO rename arguments to better describe data
function getNewPreExpDifficulty(currentTimestamp, lastPreviousBlock, blockWhichTriggeredMining, newBlockCount) {
  const preExpDiff = getDiff(currentTimestamp, lastPreviousBlock.getTimestamp(), lastPreviousBlock.getDifficulty(), BC_MINIMUM_DIFFICULTY, newBlockCount, blockWhichTriggeredMining // aka getNewestHeader(newBlock)
  ); // Calculate the final pre-singularity difficulty adjustment

  return preExpDiff;
}

/**
 * Return the `work` - string to which the distance is being guessed while mining
 *
 * @param {string} previousBlockHash Hash of last known previously mined BC block
 * @param {BlockchainHeaders} childrenCurrentBlocks Last know rovered blocks from each chain (one of them is the one which triggered mining)
 * @return {string} a hash representing the work
 */
function prepareWork(previousBlockHash, childrenCurrentBlocks) {
  const newChainRoot = getChildrenRootHash(getChildrenBlocksHashes(blockchainMapToList(childrenCurrentBlocks)));
  const work = blake2bl(newChainRoot.xor(new BN(toHexBuffer(previousBlockHash))).toString());

  return work;
}

const copyHeader = (block, confirmations) => {
  const header = new BlockchainHeader();
  header.setBlockchain(block.getBlockchain());
  header.setHash(block.getHash());
  header.setPreviousHash(block.getPreviousHash());
  header.setTimestamp(block.getTimestamp());
  header.setHeight(block.getHeight());
  header.setMerkleRoot(block.getMerkleRoot());
  header.setBlockchainConfirmationsInParentCount(confirmations);
  header.setMarkedTxsList(block.getMarkedTxsList());
  header.setMarkedTxCount(block.getMarkedTxsList().length);
  return header;
};

function prepareChildBlockHeadersMapForGenesis(currentBlockchainHeaders) {
  const newMap = new BlockchainHeaders();
  currentBlockchainHeaders.forEach(header => {
    const blockchainHeader = copyHeader(header, 1);
    const methodNameSet = `set${header.getBlockchain()[0].toUpperCase() + header.getBlockchain().slice(1)}List`; // e.g. setBtcList
    newMap[methodNameSet]([blockchainHeader]);
  });
  return newMap;
}

/**
 * Create a BlockchainHeader{} for new BcBlock, before count new confirmation count for each child block.
 *
 * Assumption here is that confirmation count of all headers from previous block is taken and incrementend by one
 * except for the one which caused the new block being mine - for that case is is reset to 1
 *
 * We're starting from 1 here because it is used for dividing
 *
 * @param {BcBlock} previousBlock Last known previously mined BC block
 * @param {Block} newChildBlock The last rovereed block - this one triggered the mining
 * @param {Block[]} newChildHeaders child headers which were rovered since the previousBlock
 * @return {BlockchainHeader[]} Headers of rovered chains with confirmations count calculated
 */
const prepareChildBlockHeadersMap = async (previousBlock, newChildBlock, newChildHeaders, persistence) => {
  if (any(equals(false), newChildHeaders)) {
    throw Error(`invalid child block headers provided`);
  }
  const newChildHeadersMap = groupBy(block => block.getBlockchain(), newChildHeaders);

  const keyOrMethodToChain = keyOrMethod => keyOrMethod.replace(/^get|set/, '').replace(/List$/, '').toLowerCase();
  const chainToSet = chain => `set${chain[0].toUpperCase() + chain.slice(1)}List`;
  const chainToGet = chain => `get${chain[0].toUpperCase() + chain.slice(1)}List`;

  // logger.info(`newChildHeadersMap: ${inspect(toPairs(newChildHeadersMap).map(([chain, blocks]) => {
  //   return 'chain: ' + chain + ' headers ' + inspect(blocks.map(block => copyHeader(block, 1).toObject()))
  // }), { depth: 3 })}`)

  const newBlockchainHeaders = new BlockchainHeaders();
  // construct new BlockchainHeaders from newChildHeaders
  toPairs(newChildHeadersMap).forEach(([chain, blocks]) => {
    newBlockchainHeaders[chainToSet(chain)](blocks.map(block => copyHeader(block, 1)));
  });

  // if any list in header is empty take last header from previous block and raise confirmations by 1
  Object.keys(newBlockchainHeaders.toObject()).forEach(async listKey => {
    const chain = keyOrMethodToChain(listKey);
    const newlyAssignedBlocks = newBlockchainHeaders[chainToGet(chain)]();
    logger.debug(`headers empty check, with method ${chainToGet(chain)}: ${newlyAssignedBlocks.map(b => b.toObject())}`);
    if (newlyAssignedBlocks.length === 0) {
      const lastHeaderFromPreviousBlock = last(previousBlock.getBlockchainHeaders()[chainToGet(chain)]());
      if (!lastHeaderFromPreviousBlock) {
        throw new Error(`Previous BC block ${previousBlock.getHeight()} does not have any "${chain}" headers`);
      }

      let headerFromPreviousBlock = copyHeader(lastHeaderFromPreviousBlock, lastHeaderFromPreviousBlock.getBlockchainConfirmationsInParentCount() + 1);
      if (persistence) {
        let diskBlock = await persistence.getBlockByHash(lastHeaderFromPreviousBlock.getHash(), chain);
        if (diskBlock && diskBlock.getHash) {
          const confirmations = lastHeaderFromPreviousBlock.getBlockchainConfirmationsInParentCount() + 1;
          logger.debug(`loaded disk block ${diskBlock.getHeight()}, confirmations: ${confirmations}`);
          headerFromPreviousBlock = copyHeader(diskBlock, confirmations);
        }
      }
      newBlockchainHeaders[chainToSet(chain)]([headerFromPreviousBlock]);
    }
  });

  debug(`prepareChildBlockHeadersMap: previous BC block: ${previousBlock.getHeight()} final headers: ${inspect(Object.values(newBlockchainHeaders.toObject()), { depth: 3 })}`);

  return newBlockchainHeaders;
};

/**
 * How many new child blocks are between previousBlockHeaders and currentBlockHeaders
 */
function getNewBlockCount(previousBlockHeaders, currentBlockHeaders) {
  // $FlowFixMe - protbuf toObject is not typed
  return getChildBlockDiff(previousBlockHeaders, currentBlockHeaders);
  // const headersToHashes = (headers: BlockchainHeaders) => Object.values(currentBlockHeaders.toObject()).reduce((acc, curr) => acc.concat(curr), []).map(headerObj => headerObj.hash)
  // const previousHashes = headersToHashes(previousBlockHeaders)
  // const currentHashes = headersToHashes(currentBlockHeaders)

  // return difference(currentHashes, previousHashes).length
}

/**
 * How many new child blocks are between previousBlockHeaders and currentBlockHeaders
 */
function getChildBlockDiff(previousBlockHeaders, currentBlockHeaders) {
  // $FlowFixMe - protbuf toObject is not typed
  const a = previousBlockHeaders.toObject();
  const b = currentBlockHeaders.toObject();
  const blockHeightSum = Object.keys(b).reduce((total, key) => {
    if (last(a[key]) && last(b[key])) {
      const aDiff = Number(last(a[key]).height);
      const bDiff = Number(last(b[key]).height);
      const diff = bDiff - aDiff;
      total = total + diff;
    }
    return total;
  }, 0);
  return blockHeightSum;
}

/**
 * How many new child blocks are between previousBlockHeaders and currentBlockHeaders
 */
//export function getChildBlockDiff (previousBlockHeaders: BlockchainHeaders, currentBlockHeaders: BlockchainHeaders) {
//  // $FlowFixMe - protbuf toObject is not typed
//  const a = previousBlockHeaders.toObject()
//  const b = currentBlockHeaders.toObject()
//
//  return Object.keys(b).reduce((total, key) => {
//    const sa = a[key].map((header) => { return header.hash })
//    const sb = b[key].map((header) => { return header.hash })
//    total = total + difference(sa, sb).length
//    return total
//  }, 0)
//}

/**
 * How many new child HASHES are between previousBlockHeaders and currentBlockHeaders
 */
function getUniqueHashes(previousBlockHeaders, currentBlockHeaders) {
  // $FlowFixMe - protbuf toObject is not typed
  const headersToHashes = headers => Object.values(previousBlockHeaders.toObject()).reduce((acc, curr) => acc.concat(curr), []).map(headerObj => headerObj.hash);
  const previousHashes = headersToHashes(previousBlockHeaders);
  logger.info('previousHashes: ' + previousHashes);
  const currentHashes = headersToHashes(currentBlockHeaders);
  logger.info('currentHashes: ' + currentHashes);

  return difference(currentHashes, previousHashes);
  // return currentBlockHeaders.filter((b) => {
  //  if (diff.indexOf(b.getHash()) > -1) {
  //    return b
  //  }
  // })
}

/**
 * How many new child blocks are between previousBlockHeaders and currentBlockHeaders
 */
function getUniqueBlocks(previousBlockHeaders, currentBlockHeaders) {
  // $FlowFixMe - protbuf toObject is not typed
  const headersToHashes = headers => Object.values(previousBlockHeaders.toObject()).reduce((acc, curr) => acc.concat(curr), []).map(headerObj => headerObj.hash);
  const previousHashes = headersToHashes(previousBlockHeaders);
  const currentHashes = headersToHashes(currentBlockHeaders);
  const diff = difference(currentHashes, previousHashes);

  const filterToDiff = currentBlockHeaders.filter(b => {
    if (diff.indexOf(b.getHash()) > -1) {
      return b;
    }
  });
  return filterToDiff;
}

/**
 * Used for preparing yet non existant BC block protobuf structure. Use before mining starts.
 *
 * - calculates block difficulty (from previous BC block difficulty and height, rovered chains count, and data in child chains headers) and stores it to structure
 * - stores headers of child chains (those being rovered)
 * - calculates new merkle root, hash and stores it to structure
 * - calculates new block height (previous + 1) and stores it to structure
 *
 * @param {number} currentTimestamp current timestamp reference
 * @param {BcBlock} lastPreviousBlock Last known previously mined BC block
 * @param {Block[]} newChildHeaders Child headers which were rovered since headers in lastPreviousBlock
 * @param {Block} blockWhichTriggeredMining The last rovered block - this one triggered the mining
 * @param {Transaction[]} newTransactions Transactions which will be added to newly mined block
 * @param {string} minerAddress Public addres to which NRG award for mining the block and transactions will be credited to
 * @param {BcBlock} unfinishedBlock If miner was running this is the block currently mined
 * @return {BcBlock} Prepared structure of the new BC block, does not contain `nonce` and `distance` which will be filled after successful mining of the block
 */
const prepareNewBlock = exports.prepareNewBlock = async (currentTimestamp, lastPreviousBlock, newChildHeaders, blockWhichTriggeredMining, newTransactions, minerAddress, unfinishedBlock, persistence, nrgGrant) => {
  let childBlockHeaders;
  if (lastPreviousBlock !== undefined && lastPreviousBlock.getHeight() === GENESIS_DATA.height) {
    childBlockHeaders = prepareChildBlockHeadersMapForGenesis(newChildHeaders);
  } else {
    childBlockHeaders = await prepareChildBlockHeadersMap(unfinishedBlock || lastPreviousBlock, blockWhichTriggeredMining, newChildHeaders, persistence);
    // make sure the block triggered mining is actually the newest of the set
    blockWhichTriggeredMining = getNewestHeader(childBlockHeaders);
  }

  // debug(' BLOCK WHICH TRIGGERED MINING ')
  // debug(blockWhichTriggeredMining)
  // debug(' CHILD BLOCK HEADERS ' )
  // debug(childBlockHeaders)
  // debug(' LAST PREVIOUS BLOCK HEADERS' )
  // debug(lastPreviousBlock.getBlockchainHeaders())

  const blockHashes = getChildrenBlocksHashes(blockchainMapToList(childBlockHeaders));
  const newChainRoot = getChildrenRootHash(blockHashes);
  const newBlockCount = parseInt(lastPreviousBlock.getHeight(), 10) === 1 ? 1 : getNewBlockCount(lastPreviousBlock.getBlockchainHeaders(), childBlockHeaders);

  debug('currentTimestamp: ' + currentTimestamp);
  debug('newBlockCount: ' + newBlockCount);

  const preExpDiff = getNewPreExpDifficulty(currentTimestamp, lastPreviousBlock, blockWhichTriggeredMining, newBlockCount);

  // debug('preExpDiff: ' + preExpDiff)
  const finalDifficulty = getExpFactorDiff(preExpDiff, lastPreviousBlock.getHeight()).toString();
  const heightIncrement = 1;
  const newHeight = lastPreviousBlock.getHeight() + heightIncrement;

  // blockchains, transactions, miner address, height
  const newMerkleRoot = createMerkleRoot(concatAll([blockHashes, newTransactions.map(tx => tx.getHash()), [finalDifficulty, minerAddress, newHeight, GENESIS_DATA.version, GENESIS_DATA.schemaVersion, nrgGrant, // NRG Grant
  GENESIS_DATA.blockchainFingerprintsRoot]]));

  // LDL
  // logger.debug(`block hashes: ${JSON.stringify(blockHashes, null, 2)}`)
  // logger.debug(`block txs: ${JSON.stringify(newTransactions.map(tx => tx.getHash()), null, 2)}`)
  // logger.debug(`difficulty: ${finalDifficulty}`)
  // logger.debug(`miner address: ${minerAddress}`)
  // logger.debug(`new height: ${newHeight}`)
  // logger.debug(`version: ${GENESIS_DATA.version}`)
  // logger.debug(`schemaVersion: ${GENESIS_DATA.schemaVersion}`)
  // logger.debug(`NRG grant: ${2}`)
  // logger.debug(`blockchain fingerprint root: ${GENESIS_DATA.blockchainFingerprintsRoot}`)
  // logger.debug(`created merkle root: ${newMerkleRoot}`)

  let chainWeight = 0;
  if (new BN(lastPreviousBlock.getHeight()).gt(2) === true) {
    chainWeight = new BN(lastPreviousBlock.getDistance()).sub(new BN(lastPreviousBlock.getDifficulty())).divRound(new BN(8)).toString();
  }

  const newBlock = new BcBlock();
  newBlock.setHash(blake2bl(lastPreviousBlock.getHash() + newMerkleRoot));
  newBlock.setPreviousHash(lastPreviousBlock.getHash());
  newBlock.setVersion(1);
  newBlock.setSchemaVersion(1);
  newBlock.setHeight(newHeight);
  newBlock.setMiner(minerAddress);
  newBlock.setDifficulty(finalDifficulty);
  newBlock.setMerkleRoot(newMerkleRoot);
  newBlock.setChainRoot(blake2bl(newChainRoot.toString()));
  newBlock.setDistance(chainWeight); // is set to proper value after successful mining
  newBlock.setTotalDistance(lastPreviousBlock.getTotalDistance()); // distance from mining solution will be added to this after mining
  newBlock.setNrgGrant(GENESIS_DATA.nrgGrant);
  // newBlock.setTargetHash(GENESIS_DATA.targetHash)
  // newBlock.setTargetHeight(GENESIS_DATA.targetHeight)
  // newBlock.setTargetMiner(GENESIS_DATA.targetMiner)
  // newBlock.setTargetSignature(GENESIS_DATA.targetSignature)
  newBlock.setTwn(GENESIS_DATA.twn);
  newBlock.setTwsList(GENESIS_DATA.twsList);
  newBlock.setEmblemWeight(GENESIS_DATA.emblemWeight);
  /// newBlock.setEmblemChainBlockHash(GENESIS_DATA.emblemChainBlockHash)
  newBlock.setEmblemChainFingerprintRoot(GENESIS_DATA.emblemChainFingerprintRoot);
  newBlock.setEmblemChainAddress(GENESIS_DATA.emblemChainAddress);
  newBlock.setTxCount(newTransactions.length);
  newBlock.setTxsList(newTransactions);
  newBlock.setBlockchainHeadersCount(newBlockCount);
  newBlock.setBlockchainFingerprintsRoot(GENESIS_DATA.blockchainFingerprintsRoot);
  newBlock.setTxFeeBase(GENESIS_DATA.txFeeBase);
  newBlock.setTxDistanceSumLimit(GENESIS_DATA.txDistanceSumLimit);
  newBlock.setBlockchainHeaders(childBlockHeaders);

  debug('distance <- minimum difficulty threshold ' + newBlock.getDifficulty());

  return [newBlock, currentTimestamp, blockWhichTriggeredMining];
};