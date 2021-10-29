'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});


const debug = require('debug')('bcnode:bc:blockchainmanager'); /*
                                                                * Copyright (c) 2017-present, Block Collider developers, All rights reserved.
                                                                *
                                                                * This source code is licensed under the MIT license found in the
                                                                * LICENSE file in the root directory of this source tree.
                                                                *
                                                                * 
                                                                */

const BN = require('bn.js');
const { getLogger } = require('../logger');
const { Block, BcBlock } = require('@overline/proto/proto/core_pb');

/*
 * abstracts individual consensus logic for blockchains or sequenced data added to Block Collider or Super Colliders
 */
class BlockchainManager {

  constructor(colliderChain = 'bc', emblemChain = 'eth', chainState, opts = {}) {
    /*
     * @class BlockchainManager
     * !!! IMPORTANT !!!
     * The class is READ ONLY never writes to ChainState, disk, nor access persistence.
     * The class is designed to enable soft fork upgrades and blockchain additions without logic that changes global state.
     */

    emblemChain = emblemChain.toLowerCase();
    colliderChain = colliderChain.toLowerCase();
    this._chainState = chainState;
    this._blockchains = opts.rovers ? opts.rovers : [emblemChain];
    this._persistence = opts.persistence;
    this._blockchains.push(colliderChain);

    // check if this is a super collider
    // if (this._blockchains.indexOf(emblemChain) < 0 && !opts.superCollider) {
    //  throw new Error(`"${emblemChain}" rover not found to assert Emblem immutability`)
    // }
    // }

    if (this._blockchains.indexOf(emblemChain) < 0) {
      this._blockchains.push(emblemChain);
    }

    this._logger = getLogger(__filename);

    this._colliderChain = colliderChain;
    this._emblemChain = emblemChain;
  }

  get colliderChain() {
    return this._colliderChain;
  }

  get emblemChain() {
    return this._emblemChain;
  }

  /*
   * @method handleBcBlock
   */

  /*
   * @method handleBtcBlock
   */

  /*
   * @method handleEthBlock
   */

  /*
   * @method handleWavBlock
   */

  /*
   * @method handleLskBlock
   */

  /*
   * @method handleWavBlock
   */

  /*
   * @method handleLibraBlock
   */

  /*
   * @method blockExtendsChain
   * Determines if the given block correctly extends the chain permitting for different forms of consensus given each chain
   */
  async blockExtendsChain(block) {
    const blockchain = block.getBlockchain ? block.getBlockchain().toLowerCase() : 'bc';

    if (!blockchain) {
      throw new Error('invalid block data structure');
    }

    this._logger.debug(`evaluating isLatestBlock for ${blockchain}`);

    switch (blockchain) {
      /*
       * Redirect validation to logic bound to the given blockchain
       * Won't have to use this until BC2 (paneling)
       */
      // case 'bc':
      //   return this._bcBlockExtendsChain(block)
      //   break;
      // case 'btc':
      //  break;
      // case 'eth':
      //  break;
      // case 'neo':
      //  break;
      // case 'lsk':
      //  break;
      // case 'wav':
      //  break;

      default:
        // default handler
        return this._defaultBlockExtendsChain(block);
    }
  }

  /*
   * @method _bcBlockExtendsChain
   * Method handles the light confermation
   */
  _bcBlockExtendsChain(block) {
    const blockchain = 'bc';
    const latestBlockHeight = this._chainState.getLatestBlockHeight(blockchain);
    const latestBlockHash = this._chainState.getLatestBlockHash(blockchain);

    // Case 1. Either latest block height or latest block hash have NOT been assigned in chainstate
    if (!latestBlockHeight || !latestBlockHash) {
      this._logger.info(`latest block height and latest block hash are not set, setting them to new ${block.getHeight()} and ${block.getHash()}`);
      return true;
    }

    const blockAboveLatestHeight = new BN(latestBlockHeight).gt(new BN(block.getHeight()));
    const blockReferencesPreviousHash = block.getPreviousHash() === latestBlockHash;

    if (blockAboveLatestHeight && blockReferencesPreviousHash) {
      // const combinedChildHeightSum = BLOCKCHAINS.reduce((all, item) => {
      //  if (all === false) { return all }
      //  if (item !== 'bc') {
      //    const val = this._chainState.getLatestBlockHeight(item.toLowerCase())
      //    if (val) {
      //      all = new BN(all).add(new BN(val))
      //    } else {
      //      all = false
      //    }
      //  }
      //  return all
      // }, 0)

      /// / Case 2. Not all child heights were available
      // if (combinedChildHeightSum === false) {
      //  // DEBUG
      //  this._logger.info(`not all child heights were avalaible`)
      //  return false
      // }

      // const blockChildHeightSum = childrenHeightSum(block)
      // // DEBUG
      // this._logger.info(`child height sum: ${blockChildHeightSum}`)

      //  // Case 3. Child heights are lower or equal
      //  if (new BN(combinedChildHeights).lte(new BN(blockChildHeightSum))) {
      //    return false
      //  }

      return true;
    } else {
      // all other cases the block is not an extension of the current chain
      return false;
    }
  }

  /*
   * @method _defaultBlockExtendsChain
   * Catch-all for blocks sent to block extends chain
   */
  async _defaultBlockExtendsChain(block) {
    // DO NOT CHANGE THE FOLLOWING -> TYPEOF DOES NOT WORK
    const blockchain = block.getBlockchain ? block.getBlockchain().toLowerCase() : 'bc';
    const latestBlock = await this._persistence.get(`${blockchain}.block.latest`);

    if (!latestBlock) {
      return false;
    }

    const latestBlockHeight = parseInt(latestBlock.getHeight(), 10);
    // const latestBlockHeight = this._chainState.getLatestBlockHeight(blockchain)
    const latestBlockHash = latestBlock.getHash();
    // const latestBlockHash = this._chainState.getLatestBlockHash(blockchain)
    // DEBUG
    debug(`check if ${blockchain} latestBlockHeight ${latestBlockHeight} and latestBlockHash ${latestBlockHash} can be extended`);

    // Case 1. Either latest block height or latest block hash have NOT been assigned in chainstate
    if (!latestBlockHeight || !latestBlockHash) {
      // DEBUG
      debug(`blockchain ${blockchain} latest block height not available for review`);
      return true;
    }

    // Case 2. Given block references the previous hash and increments the number correctly (this does not assert child chain connections)
    const blockAboveLatestHeight = new BN(block.getHeight()).gt(new BN(latestBlockHeight));
    const blockReferencesPreviousHash = block.getPreviousHash() === latestBlockHash;

    if (blockAboveLatestHeight && blockReferencesPreviousHash) {
      // DEBUG
      debug(`${blockchain} block at height ${block.getHeight()} has previous has (${block.getPreviousHash()}) extends ${latestBlockHeight} (${latestBlockHash})`);
      return true;
    } else {
      debug(`${blockchain} block at height ${block.getHeight()} ${block.getHash()} (previous: ${block.getPreviousHash()}) does not extend ${latestBlockHeight} (${latestBlockHash})`);
      // all other cases the block is not an extension of the current chain
      return false;
    }
  }
}
exports.BlockchainManager = BlockchainManager;