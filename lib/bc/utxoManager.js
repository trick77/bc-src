'use strict';

const { Decimal } = require('decimal.js'); /**
                                            * Copyright (c) 2017-present, Overline-BSI developers, All rights reserved.
                                            *
                                            * This source code is licensed under the MIT license found in the
                                            * LICENSE file in the root directory of this source tree.
                                            *
                                            * 
                                            */

const BN = require('bn.js');
const debug = require('debug')('bcnode:utxoManager');
const debugAddress = require('debug')('bcnode:utxoManager:address');
const debugEMBBalance = require('debug')('bcnode:utxoManager:emb');
const debugMarking = require('debug')('bcnode:utxoManager:marking');
const debugMarked = require('debug')('bcnode:utxoManager:marked');
const debugSettle = require('debug')('bcnode:utxoManager:settle');
const debugSpending = require('debug')('bcnode:utxoManager:spending');
const debugUTXO = require('debug')('bcnode:utxoManager:utxos');
const debugUTXODetail = require('debug')('bcnode:utxoManager:utxosDetail');
const debugWriteOperations = require('debug')('bcnode:utxoManager:writeoperations');
const { last, zipObj } = require('ramda');

const { Utxo } = require('@overline/proto/proto/core_pb');
const { toASM } = require('bcjs/dist/script/bytecode');
const { ScriptType } = require('bcjs/dist/script/templates');
const { calcTxFee } = require('bcjs/dist/transaction');

const { getChildBlocks } = require('../bc/tokenDictionary');
const { getDetailsFromMtx, getAllMarkedTxs } = require('../bc/util');
const { networks, wasabiBulletProofs } = require('../config/networks');
const { internalToHuman, internalToBN, COIN_FRACS: { NRG, BOSON } } = require('../core/coin');
const {
  getMarkedTransactionsMerkle,
  parseTakerUnlockScript,
  parseMakerLockScript,
  parseTakerLockScript
} = require('../core/txUtils');
const { getLogger } = require('../logger');
const { NRG_MINTED_PERSISTENCE_KEY } = require('../persistence/rocksdb');
const { parseBoolean } = require('../utils/config');
const { blake2bl } = require('../utils/crypto');
const { sortBlocks } = require('../utils/protoBuffers');
const { shortenHash } = require('../utils/strings');

Decimal.set({ toExpPos: 100 });
Decimal.set({ toExpNeg: -100 });

const BC_ADD_REMOVE_BLOCK_LOG = process.env.BC_ADD_REMOVE_BLOCK_LOG ? parseBoolean(process.env.BC_ADD_REMOVE_BLOCK_LOG) : false;
const BC_NETWORK = process.env.BC_NETWORK || 'main';
const BC_NO_CLEAN = process.env.BC_NO_CLEAN ? parseBoolean(process.env.BC_NO_CLEAN) : false;
const BC_SUPER_COLLIDER = process.env.BC_SUPER_COLLIDER ? process.env.BC_SUPER_COLLIDER.toLowerCase() : 'bc';
const EMBLEM_CONTRACT_ADDRESS = networks[BC_NETWORK].rovers.eth.embContractId;
const OL_FAST_SYNC = process.env.OL_FAST_SYNC ? parseBoolean(process.env.OL_FAST_SYNC) : false;

let ADD = false;
let REMOVE = false;
if (BC_ADD_REMOVE_BLOCK_LOG) {
  ADD = require('fs').createWriteStream('add_block_log_utxo_manager.csv', 'utf-8');
  REMOVE = require('fs').createWriteStream('remove_block_log_utxo_manager.csv', 'utf-8');
  ADD.write('timestamp,height,hash\n');
  REMOVE.write('timestamp,height,hash\n');
}

class UtxoManager {

  constructor(persistence) {
    this._persistence = persistence;
    this._logger = getLogger(__dirname);
    this._readEventTable = {};
    this._writeEventTable = {};
    this._activeWaypoint = false;
    this.utxoListeners = 0;
  }

  async updateUTXOs(block, remove = false, calledFrom = 'utxoManager') {
    let date = Date.now();
    let result = { result: false, tryAddingNewTxs: [], markAsMinedTxs: [] };
    if (!block) {
      return;
    }
    // debugUTXO(`called updateUTXOs on ${block.getHeight()}`);
    // if we're about to add utxos for a block and save it, check that the child blocks pass
    if (!remove) {
      const startTest = Date.now();
      debugUTXO(`running put block rover test ${startTest}`);
      const childBlockPassesRoveredBlock = await this.putBlockPassesRoverTest(block, { calledFrom });
      debugUTXO(`block rover test complete  ${Math.floor((Date.now() - startTest) / 1000)}`);
      if (!childBlockPassesRoveredBlock) {
        this._logger.info(`block ${block.getHeight()} failed childBlockPassesRoveredBlock`);
        return result;
      }
      // TD investigate why this happens
      if (!BC_NO_CLEAN && parseInt(block.getHeight(), 10) % 1000 === 0) await this.cleanUpUTXOs();
    } else {
      const txs = block.getTxsList();
      for (let i = 0; i < txs.length; i++) {
        let tx = txs[i];
        await this._persistence.delTransactionBlockIndex([tx.getHash()], block.getHash(), block.getHeight(), 0, 'bc');
      }
    }

    let lastSavedBlock = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.last.utxoSaved`);
    if (!lastSavedBlock && block.getHeight() !== 1) {
      return false;
    }
    let isUpdating = await this._persistence.get(`updateUTXOs`);

    if (isUpdating === `${remove ? 'REMOVING' : 'SAVING'}.${block.getHash()}`) {
      debugUTXO(`running update on ${block.getHash()}`);
    } else if (lastSavedBlock) {
      // check if block being evaluated is in order
      if (remove && lastSavedBlock.getHash() !== block.getHash()) {
        debugUTXO(`${lastSavedBlock.getHeight()} was the last block saved`);
        return result;
      }

      if (!remove && lastSavedBlock.getHash() !== block.getPreviousHash()) {
        debugUTXO(`${lastSavedBlock.getHeight()} was the last block saved`);
        return result;
      }
    }

    // check if another block is being saved right now
    if (isUpdating) debugUTXO(`isUpdating is ${isUpdating}`);
    if (isUpdating && isUpdating !== `${remove ? 'REMOVING' : 'SAVING'}.${block.getHash()}`) {
      debugUTXO(`in the midst of an update of ${isUpdating} while evaluating ${block.getHeight()}:${shortenHash(block.getHash())}`);
      return result;
    } else {
      await this._persistence.put(`updateUTXOs`, `${remove ? 'REMOVING' : 'SAVING'}.${block.getHash()}`);
    }

    // cost 1s
    const txs = await this._persistence.getUnspentAndSpentForBlock(block);
    if (txs === false) {
      await this._persistence.del(`updateUTXOs`);
      return result;
    }
    const { utxos, stxos } = txs;
    debugUTXO(`timing section A: ${(Date.now() - date) / 1000} request: ${block.getHeight()}-${block.getHash().slice(0, 8)} called from ${calledFrom}`);

    const utxosToSave = [];
    let txsList = block.getTxsList();
    for (let tx of txsList) {
      let inputs = tx.getInputsList();
      for (let input of inputs) {
        let hash = input.getOutPoint().getHash();
        let index = input.getOutPoint().getIndex();
        if (!remove) {
          await this._persistence.put(`opspent.${hash}.${index}`, tx.getHash());
        } else {
          await this._persistence.del(`opspent.${hash}.${index}`);
        }
      }
    }

    // save each utxo for each script type
    for (const scriptType of Object.keys(utxos)) {
      debugUTXO(`timing section C-${scriptType}: ${(Date.now() - date) / 1000} request: ${block.getHeight()}-${block.getHash().slice(0, 8)} called from ${calledFrom}`);
      if (scriptType === 'taker_output' && utxos[scriptType].length > 0) {
        if (remove) {
          // TD this needs to be investigated
          await this._persistence.delBlockHasTaker(block.getHeight());
        } else {
          await this._persistence.setBlockHasTaker(block.getHeight());
        }
      }
      await this.addUTXO(scriptType, remove ? stxos[scriptType] : utxos[scriptType], block);
      await this.delUTXO(scriptType, remove ? utxos[scriptType] : stxos[scriptType], block);
    }

    debugUTXO(`timing section C: ${(Date.now() - date) / 1000} request: ${block.getHeight()}-${block.getHash().slice(0, 8)} called from ${calledFrom}`);

    // remove the settling of any trades that occured during this block
    if (remove) {
      // TD
      let prevBlock = await this._persistence.getBlockByHash(block.getPreviousHash(), 'bc');
      if (!prevBlock) {
        prevBlock = await this._persistence.getBlockByHeight(block.getHeight() - 1, 'bc');
        if (prevBlock && prevBlock.getHash) {
          if (prevBlock.getHash() !== block.getPreviousHash()) {
            prevBlock = false;
          }
        }
      }
      await this._removeBcBlock(block);
      await this._persistence.put('bc.block.last.utxoSaved', prevBlock);
      await this._persistence.del(`bc.block.${block.getHeight()}.utxoSaved`);
      debugUTXO(`timing section D: ${(Date.now() - date) / 1000} request: ${block.getHeight()}-${block.getHash().slice(0, 8)} called from ${calledFrom}`);
    } else {
      // settle any trades that occured during this block
      await this._persistence.put('bc.block.last.utxoSaved', block);
      await this._persistence.put(`bc.block.${block.getHeight()}.utxoSaved`, block.getHash());
      await this._onNewBcBlock(block);
      debugUTXO(`timing section E: ${(Date.now() - date) / 1000} request: ${block.getHeight()}-${block.getHash().slice(0, 8)} called from ${calledFrom}`);
      result.markAsMinedTxs = block.getTxsList();
    }
    // if (lastSavedBlock) debugUTXO(`${remove ? 'REMOVING #1' : 'SAVING #1'} took ${(Date.now() - date)/1000} sec for ${block.getHeight()}:${shortenHash(block.getHash())}:${shortenHash(block.getPreviousHash())}, LAST is ${lastSavedBlock.getHeight()}:${shortenHash(lastSavedBlock.getHash())}`)

    // update NRG Supply
    let updateNRG = await this._persistence.get(`nrg_calculated`);
    if (updateNRG && parseInt(updateNRG) === parseInt(block.getHeight()) - 1 && !remove) {
      let mintedNrgTotal = await this._persistence.getNrgMintedSoFar();
      let blockNRG = this.extractMintedNRG(block);
      mintedNrgTotal = new Decimal(mintedNrgTotal).add(blockNRG);
      debugUTXO(`nrg supply is ${mintedNrgTotal.toString()} and this is added`);
      await this.setNrgMintedSoFar(mintedNrgTotal.toString());
      await this._persistence.put(`nrg_calculated`, block.getHeight());
      debugUTXO(`timing section F: ${(Date.now() - date) / 1000} request: ${block.getHeight()}-${block.getHash().slice(0, 8)} called from ${calledFrom}`);
    } else if (updateNRG && parseInt(updateNRG) === parseInt(block.getHeight()) && remove) {
      let mintedNrgTotal = await this._persistence.getNrgMintedSoFar();
      let blockNRG = this.extractMintedNRG(block);
      mintedNrgTotal = new Decimal(mintedNrgTotal).sub(blockNRG);
      debugUTXO(`nrg supply is ${mintedNrgTotal.toString()} and this is removed`);
      await this.setNrgMintedSoFar(mintedNrgTotal.toString());
      await this._persistence.put(`nrg_calculated`, parseInt(block.getHeight()) - 1);
      debugUTXO(`timing section G: ${(Date.now() - date) / 1000} request: ${block.getHeight()}-${block.getHash().slice(0, 8)} called from ${calledFrom}`);
    }

    await this._persistence.del(`updateUTXOs`);
    for (const scriptType of Object.keys(utxos)) {
      await this._persistence.del(`utxo.${scriptType}.length.${block.getHash()}`);
    }

    if (lastSavedBlock) {
      if (remove) {
        debugUTXO(`${remove ? 'REMOVING' : 'SAVING'} took ${(Date.now() - date) / 1000} sec for ${block.getHeight()}:${shortenHash(block.getHash())}:${shortenHash(block.getPreviousHash())}, LAST is ${lastSavedBlock.getHeight()}:${shortenHash(lastSavedBlock.getHash())}`);
      } else {
        debugUTXO(`${remove ? 'REMOVING' : 'SAVING'} took ${(Date.now() - date) / 1000} sec for ${block.getHeight()}:${shortenHash(block.getHash())}:${shortenHash(block.getPreviousHash())}, LAST is ${lastSavedBlock.getHeight()}:${shortenHash(lastSavedBlock.getHash())}`);
      }
    }

    if (remove) {
      for (const tx of block.getTxsList()) {
        debugUTXO(`reading ${tx.getHash()}`);
        if (tx && tx.getInputsList && tx.getInputsList().length !== 0) {
          result.tryAddingNewTxs.push(tx);
        }
      }
    }

    result.result = true;
    return result;
  }

  async areUTXOsSavedForBlock(height, hash) {
    const saved = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.${height}.utxoSaved`);
    return saved === hash;
  }

  async removeUTXOsFrom(height) {
    let result = { result: false, tryAddingNewTxs: [], markAsMinedTxs: [] };
    let lastSavedBlock = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.last.utxoSaved`);
    if (lastSavedBlock) {
      // just remove the last block if the same height as the latest
      if (lastSavedBlock.getHeight() === height) {
        let updateUTXOsResult = await this.updateUTXOs(lastSavedBlock, true);
        return updateUTXOsResult;
      } else if (lastSavedBlock.getHeight() > height) {
        // else if the latest block saved is heigher than the removal request,
        // traverse down the blocks
        let block = lastSavedBlock;
        let blocksToRemove = [block];
        let reindex = false;

        for (let i = lastSavedBlock.getHeight(); i > height; i--) {
          if (block) {
            const lastSavedHeight = block.getHeight();
            block = await this._persistence.getBlockByHash(block.getPreviousHash());
            if (!block) {
              const blocks = await this._persistence.getBlocksByHeight(lastSavedHeight - 1, BC_SUPER_COLLIDER);
              block = !blocks ? false : blocks.reduce((all, b) => {
                if (all) return all;
                if (block.getPreviousHash() === b.getHash()) {
                  reindex = true;
                  all = b;
                }
                return all;
              }, false);
            }
          }
          if (reindex) {
            debug(`reindexing ${block.getHeight()}:${block.getHash()}`);
            await this._persistence.putBlockHashAtHeight(block.getHash(), block.getHeight());
          }
          if (block) {
            blocksToRemove.push(block);
          }
          if (block) block = await this._persistence.getBlockByHash(block.getPreviousHash());
          if (block) blocksToRemove.push(block);
        }

        //for (let i = lastSavedBlock.getHeight(); i > height; i--) {
        //  if (block) block = await this._persistence.getBlockByHash(block.getPreviousHash())
        //  if (block) blocksToRemove.push(block)
        //}

        for (let i = 0; i < blocksToRemove.length; i++) {
          const removeBlock = blocksToRemove[i];
          let updateUTXOsResult = await this.updateUTXOs(removeBlock, true);
          if (!updateUTXOsResult.result) {
            return result;
          } else {
            result.tryAddingNewTxs = result.tryAddingNewTxs.concat(updateUTXOsResult.tryAddingNewTxs);
            result.markAsMinedTxs = result.markAsMinedTxs.concat(updateUTXOsResult.markAsMinedTxs);
          }
        }
      } else {
        debug(`no last saved block ${height}`);
      }
    }
    result.result = true;
    return result;
  }

  async cleanUpUTXOs() {
    debugUTXO('calling cleanup');
    let date = Date.now();
    // save each utxo for each script type
    const utxos = { maker_output: [], taker_output: [], taker_callback: [] };
    for (let i = 0; i < Object.keys(utxos).length; i++) {
      let keys = [];
      let scriptType = Object.keys(utxos)[i];
      const length = await this.getUtxosLength(scriptType);
      const count = await this.getUtxosCount(scriptType);

      let nullIndexes = [];
      let fullIndexes = [];
      // collect all null and full indexes
      for (let j = 0; j < length; j++) {
        let utxo = await this._persistence.get(`utxo.${scriptType}.${j}`);
        if (!utxo) {
          nullIndexes.push(j);
        } else {
          fullIndexes.push({ index: j, utxo });
        }
      }

      let { utxoToAddresses, addresses } = await this.extractAddressesFromUtxos(scriptType, fullIndexes.map(({ utxo }) => {
        return { txHash: utxo.getTxHash(), index: utxo.getTxIndex(), script: utxo.getOutput().getOutputScript() };
      }));

      // replace the null indexes with full indexes if null Index < fullIndex
      for (let j = 0; j < fullIndexes.length; j++) {
        let { utxo, index } = fullIndexes[j];
        let txHash = utxo.getTxHash();
        let txIndex = utxo.getTxIndex();

        for (let addr of utxoToAddresses[`${txHash}.${txIndex}`]) {
          let arrIndex = addresses[addr].indexOf(index);
          addresses[addr][arrIndex] = j;
        }
        debugUTXO(`putting opunspent.${txHash}.${txIndex} at ${j}`);
        debugUTXO(`putting utxo.${scriptType}.${j} at ${utxo}`);
        await this._persistence.put(`opunspent.${txHash}.${txIndex}`, j);
        await this._persistence.put(`utxo.${scriptType}.${j}`, utxo);
      }

      for (const addr of Object.keys(addresses)) {
        await this._persistence.put(`${addr}.${scriptType}`, [...new Set(addresses[addr])]);
      }
      await this._persistence.put(`utxo.${scriptType}.length`, fullIndexes.length);

      debugUTXO({ null: nullIndexes.length, full: fullIndexes.length, length, count });
    }
    debugUTXO(`clean up took ${Date.now() - date} ms`);
  }

  async getUtxosLength(scriptType, address) {
    if (!this._readEventTable['getUtxosLength']) {
      this._readEventTable['getUtxosLength'] = 0;
    }
    this._readEventTable['getUtxosLength']++;
    if (address === null || address === undefined || address === '') {
      let length = await this._persistence.get(`utxo.${scriptType}.length`);
      return length || 0;
    } else {
      address = '0x' + blake2bl(blake2bl(address.toLowerCase()) + address.toLowerCase());
      const indexes = await this._persistence.get(`${address}.${scriptType}`);
      return indexes ? indexes.length : 0;
    }
  }

  // private
  async _onNewBcBlock(block) {
    try {
      const date = Date.now();
      debugMarking(`adding ${block.getHeight()} : ${block.getHash().slice(0, 6)}`);
      if (BC_ADD_REMOVE_BLOCK_LOG && block && !block.getBlockchain) {
        ADD.write(`${Math.floor(Date.now() / 1000)},${block.getHeight()},${block.getHash().slice(0, 6)}\n`);
      }
      // remove uncle marked txs
      let uncleBlocks = block.getHeight() > 2925470 && block.getHeight() < 2990000 ? await this.persistence.getMarkedUncles(block) : [];
      debugUTXO(`_onNewBcBlock(): A-an up took ${Date.now() - date} ms`);
      if (uncleBlocks) {
        for (let j = 0; j < uncleBlocks.length; j++) {
          debugMarking(`uncle block is ${uncleBlocks[j].getHash()}:${uncleBlocks[j].getHeight()}`);
          let markedList = uncleBlocks[j].getMarkedTxsList();
          for (let i = 0; i < markedList.length; i++) {
            let mtx = getDetailsFromMtx(markedList[i]);
            const { chain, height, tokenType, hash, childHash } = mtx;
            await this.unsettleUncleTx(hash);
            let heightHash = await this._persistence.get(`${chain}.${tokenType}.${hash}.${childHash}.${height}`);
            if (heightHash && heightHash.split('.').length == 2) {
              let blockOfRemoval = await this._persistence.getBlockByHash(heightHash.split('.')[1]);
              if (blockOfRemoval) await this.unsettleEmbTx(mtx, blockOfRemoval);
            }
          }
        }
      }

      // TD: iterate through each tx in matchedTxs Pool
      let markedBlockTransactions = getAllMarkedTxs(block);
      debugUTXO(`_onNewBcBlock(): B-an up took ${Date.now() - date} ms`);

      if (markedBlockTransactions.length === 0) {
        return Promise.resolve(true);
      } else {
        debugMarking(`${markedBlockTransactions.length} Marked Txs within ${block.getHeight()}:${block.getHash()}`);
      }

      for (let j = 0; j < markedBlockTransactions.length; j++) {
        let mTx = markedBlockTransactions[j];
        debugMarking({ mTx });
        const { to, from, chain, amount, height, tokenType, hash, childHash } = mTx;
        let trades = await this._persistence.getTradeIndices(from, to, tokenType, amount.toString());
        debugUTXO(`_onNewBcBlock(): C-an up took ${Date.now() - date} ms ${from} -> ${to}`);
        if (trades) {
          this._sortTrades(trades);
          for (let i = 0; i < trades.length; i++) {
            let [txHash, txIndex,,, type] = trades[i].split('.');
            let isMaker = type === 'maker';
            let within = await this.isTxWithinSettlement(txHash, txIndex);
            let isSettled = await this.isTxSettled(txHash, txIndex, isMaker);
            debugUTXO(`_onNewBcBlock(): D-an up took ${Date.now() - date} ms`);
            // dealing with uncles
            let isDiffHeight = false;
            let isDiffHash = false;
            let isSameTx = true;
            const markedKey = await this._persistence.get(`settle.tx.${txHash}.${txIndex}.${isMaker ? 'maker' : 'taker'}`);
            if (markedKey) {
              const [, bcHeight, childChainId, childChainHeight,, markedTxHash] = markedKey.split('.');
              if (markedTxHash !== hash) isSameTx = false;
              if (height !== parseInt(childChainHeight)) {
                isDiffHeight = true;
              } else if (block.getHeight()) {
                let savedChildHash = await this._persistence.get(`${markedKey}.hash`);
                if (savedChildHash && savedChildHash !== childHash) isDiffHash = true;
              }
              debugMarking({
                within,
                type,
                isSettled,
                isDiffHeight,
                height,
                childChainHeight: parseInt(childChainHeight),
                isDiffHash
              });
            }
            debugMarking({ within, isSettled, isSameTx, isDiffHash, isDiffHeight });
            if (within && (!isSettled || isSameTx && isDiffHash && block.getHeight() > 2590000 || isSameTx && isDiffHeight && block.getHeight() > 2542197)) {
              let markedBlock = block;
              let settled = await this.settleTx(hash, chain, height, childHash, markedBlock.getHeight(), txHash, txIndex, isMaker);
              debugUTXO(`_onNewBcBlock(): F-an up took ${Date.now() - date} ms`);
              debugUTXO({ settled, txHash, txIndex, markedBlock });
            }
          }
        }
        if (chain === 'eth' && tokenType === 'emb') {
          debugUTXO(`emb tx: ${amount} ${from} -> ${to} ${hash}`);
          await this.settleEmbTx(mTx, block);
        }
      }
      debugUTXO(`_onNewBcBlock(): G-an up took ${Date.now() - date} ms`);

      return true;
    } catch (err) {
      this._logger.info(`onNewBcBlock err - ${err}`);
      return true;
    }
  }

  /**
   * Function used to return Emblem balance
   */
  async unsettleEmbTx({ to, from, chain, amount, height, tokenType, hash, childHash, blockHeight }, block) {
    try {
      let embIndexKey = 'credit';
      // Remove optional checksum from hashes
      to = to.toLowerCase();
      from = from.toLowerCase();
      // embIndexKey = 'leasing'
      //

      const currentHeight = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.latest.height`);
      const datalatestRaw = await this._persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);
      const datalatest = datalatestRaw && datalatestRaw.indexOf(':') > -1 ? datalatestRaw.split(':')[0] : false;

      // !!! while the node is syncing load the height in context otherwise default to current height !!!
      if (datalatest && new BN(datalatest).gt(new BN(4740006))) {
        embIndexKey = 'sigma';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      } else if (currentHeight && new BN(currentHeight).gt(new BN(4740006))) {
        embIndexKey = 'sigma';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      }

      if (datalatest && new BN(datalatest).gt(new BN(6717275))) {
        embIndexKey = 'alpha';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      } else if (currentHeight && new BN(currentHeight).gt(new BN(6717275))) {
        embIndexKey = 'alpha';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      }

      if (datalatest && new BN(datalatest).gt(new BN(7590066))) {
        embIndexKey = 'land';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      } else if (currentHeight && new BN(currentHeight).gt(new BN(7590066))) {
        embIndexKey = 'land';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      }

      if (datalatest && new BN(datalatest).gt(new BN(7662066))) {
        embIndexKey = 'friend';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      } else if (currentHeight && new BN(currentHeight).gt(new BN(7662066))) {
        embIndexKey = 'friend';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      }

      debugEMBBalance(`unsettle ${embIndexKey}`);

      const isUniqueEMBTx = await this._persistence.get(`${chain}.${tokenType}.${hash}.${childHash}.${height}`);
      debugEMBBalance(`isUniqueEMBTx is ${isUniqueEMBTx}`);
      const timestamp = Math.floor(Date.now() / 1000);
      // only remove if it is the correct block that actually referrenced this EMB transaction
      if (isUniqueEMBTx === `${block.getHeight()}.${block.getHash()}`) {
        this._logger.info(`unsettleEmbTx():  to: ${to}, from: ${from}, amount: ${amount.toNumber()}`);

        await this._persistence.del(`${chain}.${tokenType}.${hash}.${childHash}.${height}`);
        await this._persistence.del(`embcheck.${hash}`);

        const toBalanceKey = `${chain}.${tokenType}.${EMBLEM_CONTRACT_ADDRESS}.${to}.${embIndexKey}`;
        const fromBalanceKey = `${chain}.${tokenType}.${EMBLEM_CONTRACT_ADDRESS}.${from}.${embIndexKey}`;
        debugEMBBalance(`fromBalanceKey ${fromBalanceKey}`);
        debugEMBBalance(`toBalanceKey ${toBalanceKey}`);
        let fromBalanceAmount = false;

        // first attempt to readd any EMB to the original address
        const fromBalance = await this._persistence.get(fromBalanceKey);
        debugEMBBalance(`fromBalance ${fromBalance}`);
        if (fromBalance && to === from) {
          return;
        }
        if (fromBalance) {
          fromBalanceAmount = parseInt(fromBalance.split(':')[0], 10);
          // return the amount back to the original address
          const updatedFromBalance = new BN(fromBalanceAmount).add(new BN(amount));
          this._logger.info(`unsettleEmbTx(): from balance exist total amount: ${updatedFromBalance.toNumber()}`);
          await this._persistence.put(fromBalanceKey, `${updatedFromBalance.toNumber()}:${height}:${timestamp}`);
        } else {
          await this._persistence.put(fromBalanceKey, `${amount.toNumber()}:${height}:${timestamp}`);
        }

        // second attempt to update the to balance
        const toBalance = from === to && fromBalanceAmount ? fromBalance : await this._persistence.get(toBalanceKey);
        debugEMBBalance(`toBalance ${toBalance}`);
        if (toBalance) {
          const toBalanceAmount = parseInt(toBalance.split(':')[0], 10);
          const updatedToBalance = new BN(toBalanceAmount).sub(new BN(amount));
          this._logger.info(`unsettleEmbTx(): to balance exist total amount: ${updatedToBalance.toNumber()}`);
          if (0 >= updatedToBalance.toNumber()) {
            await this._persistence.del(toBalanceKey);
          } else {
            await this._persistence.put(toBalanceKey, `${updatedToBalance.toNumber()}:${height}:${timestamp}`);
          }
        }
      } else {
        this._logger.info(`unsettleEmbTx(): not unique -> to: ${to}, from: ${from}, amount: ${amount.toNumber()}`);
      }
    } catch (err) {
      this._logger.error(err);
    }
  }

  // moved from unsettledTxManagerAlt
  async _removeBcBlock(block) {
    try {
      // iterate through each tx in matchedTxs Pool

      debugMarking(`removing ${block.getHeight()} : ${block.getHash().slice(0, 6)}`);
      if (BC_ADD_REMOVE_BLOCK_LOG && block && !block.getBlockchain) {
        REMOVE.write(`${Math.floor(Date.now() / 1000)},${block.getHeight()},${block.getHash().slice(0, 6)}\n`);
      }

      let markedBlockTransactions = getAllMarkedTxs(block);

      for (let j = 0; j < markedBlockTransactions.length; j++) {
        let mTx = markedBlockTransactions[j];
        const { to, from, chain, amount, height, tokenType, hash, childHash } = mTx;
        let trades = await this._persistence.getTradeIndices(from, to, tokenType, amount.toString());
        if (trades) {
          this._sortTrades(trades);
          for (let i = 0; i < trades.length; i++) {
            let [txHash, txIndex,,, type] = trades[i].split('.');
            let isMaker = type === 'maker';
            let within = await this.isTxWithinSettlement(txHash, txIndex);
            let isSettled = await this.isTxSettled(txHash, txIndex, isMaker);
            debugMarking({ within, type, isSettled });
            if (within && isSettled) {
              let markedBlock = block;
              let unsettled = await this.unsettleTx(hash, chain, height, childHash, markedBlock.getHeight(), txHash, txIndex, isMaker);
              debugUTXO({ unsettled, txHash, txIndex });
              if (unsettled) {
                break;
              }
            }
          }
        }

        // unsettleEMBTransaction
        if (chain === 'eth' && tokenType === 'emb') {
          debugUTXO(`emb tx: ${amount} ${from} -> ${to} ${hash}`);
          await this.unsettleEmbTx(mTx, block);
        }
      }
      return true;
    } catch (err) {
      this._logger.info(`removeBcBlock err - ${err}`);
      return true;
    }
  }

  /**
   * Function used to unassociate a marked tx with a trade and vice versa when in an uncle block
   *
   * private
   */
  async unsettleUncleTx(markedTxHash) {
    try {
      let ref = await this._persistence.get(`${markedTxHash}.ref`);
      debugSettle(`unsettling ${markedTxHash}`);
      if (ref) {
        let markedKey = await this._persistence.get(ref);
        let [, childChainId, childChainHeight,, hash] = markedKey.split('.');
        let tradeKey = await this._persistence.get(markedKey);
        const markTxSavedKey = `${childChainId}.${childChainHeight}.${markedTxHash}`;
        await this._persistence.del(markedKey);
        await this._persistence.del(`${markedKey}.hash`);
        await this._persistence.del(tradeKey);
        await this._persistence.del(markTxSavedKey);
        await this._persistence.del(`${markedTxHash}.ref`);

        // removed succesfully
        return true;
      }
      // did not have ref
      return false;
    } catch (err) {
      this._logger.info(`unsettle tx err - ${err}`);
      return false;
    }
  }

  /**
   * Function used to update Emblem balance
   */
  async settleEmbTx({ to, from, chain, amount, height, tokenType, hash, childHash, blockHeight }, block) {
    try {
      // settleEmbTx
      // unsettleEmbTx
      // getMarkedBalanceData
      //
      // OL 4663856
      //
      to = to.toLowerCase();
      from = from.toLowerCase();

      //EXCEPTION
      const delMap = new Map([// map of  blockHeight -> address from
      [3220968, '0xa04c144bc6a9fb4a88dd3bbc2df2d22abaa07640'], [3220968, '0x1fc47bbf806dc6498f97d769483f6d986622d395'], [3220968, '0xaa8dbb478152cce333ea51fdf91e6b09875d8bb8']]);
      const delBlockHeight = parseInt(block.getHeight(), 10);
      if (delMap.has(delBlockHeight) && delMap.get(delBlockHeight) === from) {
        await this._persistence.del(`${chain}.${tokenType}.${EMBLEM_CONTRACT_ADDRESS}.${from}.${embIndexKey}`);
      }
      let embIndexKey = 'credit';

      const currentHeight = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.latest.height`);
      const datalatestRaw = await this._persistence.get(`${BC_SUPER_COLLIDER}.data.latest`);
      const datalatest = datalatestRaw && datalatestRaw.indexOf(':') > -1 ? datalatestRaw.split(':')[0] : false;

      // !!! while the node is syncing load the height in context otherwise default to current height !!!
      if (datalatest && new BN(datalatest).gt(new BN(4740006))) {
        embIndexKey = 'sigma';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      } else if (currentHeight && new BN(currentHeight).gt(new BN(4740006))) {
        embIndexKey = 'sigma';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      }

      if (datalatest && new BN(datalatest).gt(new BN(6717275))) {
        embIndexKey = 'alpha';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      } else if (currentHeight && new BN(currentHeight).gt(new BN(6717275))) {
        embIndexKey = 'alpha';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      }

      if (datalatest && new BN(datalatest).gt(new BN(7590066))) {
        embIndexKey = 'land';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      } else if (currentHeight && new BN(currentHeight).gt(new BN(7590066))) {
        embIndexKey = 'land';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      }

      if (datalatest && new BN(datalatest).gt(new BN(7662066))) {
        embIndexKey = 'friend';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      } else if (currentHeight && new BN(currentHeight).gt(new BN(7590066))) {
        embIndexKey = 'friend';
        if (!height && blockHeight) {
          height = blockHeight;
        }
      }

      const isUniqueTx = await this._persistence.get(`embcheck.${hash}`);
      if (isUniqueTx) {
        debugEMBBalance(`settleEmbTx():${hash} is already settled`);
        return;
      }
      debugEMBBalance(`settle ${embIndexKey}`);
      const isUniqueEMBTx = await this._persistence.get(`${chain}.${tokenType}.${hash}.${childHash}.${height}`);

      debugEMBBalance(`isUniqueEMBTx ${isUniqueEMBTx}`);

      const timestamp = Math.floor(Date.now() / 1000);

      if (!isUniqueEMBTx) {
        this._logger.info(`settleEmbTx(): to: ${to}, from: ${from}, amount: ${amount.toNumber()}`);
        // RUN EMB UPDATE HERE
        await this._persistence.put(`${chain}.${tokenType}.${hash}.${childHash}.${height}`, `${block.getHeight()}.${block.getHash()}`);
        await this._persistence.put(`embcheck.${hash}`, true);

        const toBalanceKey = `${chain}.${tokenType}.${EMBLEM_CONTRACT_ADDRESS}.${to}.${embIndexKey}`;
        const fromBalanceKey = `${chain}.${tokenType}.${EMBLEM_CONTRACT_ADDRESS}.${from}.${embIndexKey}`;
        debugEMBBalance(`fromBalanceKey ${fromBalanceKey}`);
        debugEMBBalance(`toBalanceKey ${toBalanceKey}`);
        let fromBalanceAmount = false;

        // first attempt to remove any EMB at the from Balance location (note this does may not match the child chain balance, and that is ok)
        const fromBalance = await this._persistence.get(fromBalanceKey);
        debugEMBBalance(`fromBalance ${fromBalance}`);

        if (fromBalance && to === from) {
          let oldAmount = parseInt(fromBalance.split(':')[0], 10);
          // if new amount exceeds old amount, update key
          if (new BN(amount).gt(new BN(oldAmount))) {
            this._logger.info(`settleEmbTx(): from: ${to} is now amount: ${amount.toNumber()}`);
            await this._persistence.put(fromBalanceKey, `${amount.toNumber()}:${height}:${timestamp}`);
          }
          this._logger.info(`settleEmbTx(): to === from <- returning`);
          return;
        }

        if (fromBalance) {
          fromBalanceAmount = parseInt(fromBalance.split(':')[0], 10);
          const updatedFromBalance = new BN(fromBalanceAmount).sub(new BN(amount));
          this._logger.info(`settle emb from updated balance: ${updatedFromBalance}`);
          if (0 >= updatedFromBalance.toNumber()) {
            await this._persistence.del(fromBalanceKey);
          } else {
            await this._persistence.put(fromBalanceKey, `${updatedFromBalance.toNumber()}:${height}:${timestamp}`);
          }
        } else {
          this._logger.info(`settleEmbTx(): from ${from} <- has no previous balance`);
        }

        //attempt to update the to balance
        const toBalance = to === from && fromBalanceAmount ? fromBalance : await this._persistence.get(toBalanceKey);
        debugEMBBalance(`toBalance ${toBalance}`);
        if (!toBalance) {
          this._logger.info(`settleEmbTx(): to ${to} has NO previous balance <- new amount: ${amount.toNumber()}`);
          await this._persistence.put(toBalanceKey, `${amount.toNumber()}:${height}:${timestamp}`);
        } else if (toBalance && to !== from) {
          const toBalanceAmount = parseInt(toBalance.split(':')[0], 10);
          const updatedToBalance = new BN(toBalanceAmount).add(new BN(amount));
          this._logger.info(`settleEmbTx(): to ${to} HAS previous balance <- new total amount: ${updatedToBalance.toNumber()}`);
          await this._persistence.put(toBalanceKey, `${updatedToBalance.toNumber()}:${height}:${timestamp}`);
        } else if (toBalance && to === from) {
          await this._persistence.put(toBalanceKey, `${amount.toNumber()}:${height}:${timestamp}`);
        }
      } else {
        debugEMBBalance(`settleEmbTx(): is unique -> to: ${to}, from: ${from}, amount: ${amount.toNumber()}`);
      }
    } catch (err) {
      this._logger.error(err);
    }
  }

  /**
   * Function used to unassociate a marked tx with a trade and vice versa
   */
  async unsettleTx(markedTxHash, childChainId, childChainHeight, childChainHash, bcHeight, txHash, txOutputIndex, isMaker) {
    try {
      const tradeParty = isMaker ? 'maker' : 'taker';

      const markedKey = `${BC_SUPER_COLLIDER}.${bcHeight}.${childChainId}.${childChainHeight}.markedTx.${markedTxHash}`;
      const tradeKey = `settle.tx.${txHash}.${txOutputIndex}.${tradeParty}`;
      const markTxSavedKey = `${childChainId}.${childChainHeight}.${markedTxHash}`;
      const markTxSavedHashKey = `${childChainId}.${childChainHeight}.${childChainHash}.${markedTxHash}`;
      this._logger.info(`unsetting ${tradeKey} - ${markTxSavedKey} . ${childChainHash}`);

      const markedExisting = await this._persistence.get(markedKey);
      const tradeExisting = await this._persistence.get(tradeKey);

      if (markedKey === tradeExisting && tradeKey === markedExisting) {
        await this._persistence.del(markedKey);
        await this._persistence.del(`${markedKey}.hash`);
        await this._persistence.del(tradeKey);
        await this._persistence.del(markTxSavedKey);
        await this._persistence.del(markTxSavedHashKey);
        await this._persistence.del(`${markedTxHash}.ref`);
      }

      return true;
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  /**
   * Function used to associate a marked tx with a trade and vice versa
   */
  async settleTx(markedTxHash, childChainId, childChainHeight, childChainHash, bcHeight, txHash, txOutputIndex, isMaker) {
    try {
      const tradeParty = isMaker ? 'maker' : 'taker';
      const markedKey = `${BC_SUPER_COLLIDER}.${bcHeight}.${childChainId}.${childChainHeight}.markedTx.${markedTxHash}`;
      const tradeKey = `settle.tx.${txHash}.${txOutputIndex}.${tradeParty}`;
      const markTxSavedKey = `${childChainId}.${childChainHeight}.${markedTxHash}`;
      const markTxSavedHashKey = `${childChainId}.${childChainHeight}.${childChainHash}.${markedTxHash}`;
      this._logger.info(`attempting ${tradeKey} - ${markedKey} . ${childChainHash}`);

      // check if this marked tx is being used for any other tx
      let exists = await this._persistence.get(markedKey);
      if (exists) return false;

      // check if this tx already has a marked tx associated with it
      // exists = await this._persistence.get(tradeKey)
      // if (exists) return false
      if (bcHeight > 3470000 && bcHeight < 3950000) {
        exists = await this._persistence.get(markTxSavedKey);
        if (exists) {
          return false;
        }
      } else if (bcHeight >= 3950000) {
        exists = await this._persistence.get(markTxSavedHashKey);
        if (exists) {
          return false;
        }
      }

      if (bcHeight > 2590000) {
        await this._persistence.put(`${markedKey}.hash`, childChainHash);
        await this._persistence.put(`${markedTxHash}.ref`, markedKey);
      }

      this._logger.info(`setting ${tradeKey} - ${markedKey} . ${childChainHash}`);
      await this._persistence.put(tradeKey, markedKey);
      await this._persistence.put(markedKey, tradeKey);
      await this._persistence.put(markTxSavedKey, true);
      if (bcHeight >= 3950000) {
        await this._persistence.put(markTxSavedHashKey, true);
      }

      return true;
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  extractMintedNRG(newBlock) {
    let mintedNrg = new Decimal(0);
    if (newBlock.getHeight() === 1) {
      const txOutputs = newBlock.getTxsList()[0].getOutputsList();
      for (const output of txOutputs) {
        mintedNrg = mintedNrg.add(new Decimal(internalToHuman(output.getValue(), NRG)));
      }
    } else {
      const txs = newBlock.getTxsList();
      const coinbaseTx = txs[0];
      const minerRewardBN = internalToBN(coinbaseTx.getOutputsList()[0].getValue(), BOSON);
      const blockTxs = txs.slice(1);
      const txFeesBN = blockTxs.map(tx => calcTxFee(tx)).reduce((fee, sum) => sum.add(fee), new BN(0));
      mintedNrg = new Decimal(internalToHuman(minerRewardBN.sub(txFeesBN), NRG));
    }
    return mintedNrg;
  }

  async getMarkedTxsForMatchedTx(txHash, txOutputIndex, latestBlock) {
    try {
      const makerMarkedTx = await this._persistence.get(`settle.tx.${txHash}.${txOutputIndex}.maker`);
      const takerMarkedTx = await this._persistence.get(`settle.tx.${txHash}.${txOutputIndex}.taker`);

      debugMarked({ makerMarkedTx, takerMarkedTx });
      if (!this._readEventTable['getMarkedTxsForMatchedTx']) {
        this._readEventTable['getMarkedTxsForMatchedTx'] = 0;
      }
      this._readEventTable['getMarkedTxsForMatchedTx']++;
      // console.log({makerMarkedTx,takerMarkedTx})
      const markedTxs = [];
      let hash = {};

      const output = await this._persistence.getOutputByHashAndIndex(txHash, txOutputIndex);
      const [makerScript, _, __] = await this.getInitialMakerOrder(toASM(Buffer.from(output.getOutputScript()), 0x01), 0);
      let makerOrder = parseMakerLockScript(makerScript);

      debugMarked({ makerOrder });
      for (const markedKey of [makerMarkedTx, takerMarkedTx]) {
        if (markedKey) {
          let shiftAmount = markedKey === makerMarkedTx ? makerOrder.shiftMaker : makerOrder.shiftTaker;

          let [, bcHeight, childChainId, childChainHeight,, markedTxHash] = markedKey.split('.');
          childChainId = `${childChainId[0].toUpperCase()}${childChainId.slice(1)}`;
          if (bcHeight.split(',').length > 4) {
            bcHeight = bcHeight.split(',')[4];
          }
          const bcBlock = await this._persistence.getBlockByHeight(bcHeight);
          const bcBlockNext = await this._persistence.getBlockByHeight(parseInt(bcHeight) + 1);

          debugMarked({ shiftAmount, bcHeight, childChainHeight, latestHeight: latestBlock.getHeight() });
          for (let block of [bcBlock, bcBlockNext]) {
            if (block) {
              for (const childBlock of block.getBlockchainHeaders()[`get${childChainId}List`]()) {
                if (childBlock.getHeight() === Number(childChainHeight)) {
                  for (const markedTx of childBlock.getMarkedTxsList()) {
                    if (!wasabiBulletProofs.includes(markedTxHash) && markedTx.getHash() === markedTxHash && !hash[markedTxHash]) {
                      let pastShift = await this._persistence.isRoveredBlockPastShift(childBlock.getHash(), childBlock.getHeight(), childChainId, shiftAmount + 1, latestBlock);
                      debugMarked({ pastShift });
                      if (pastShift === 1) {
                        hash[markedTxHash] = true;
                        markedTxs.push(markedTx);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      debugMarked({ markedTxs });
      return markedTxs;
    } catch (err) {
      debugMarked(err);
      return [];
    }
  }

  /**
   * Function used to check if there is a marked tx associated with the trade
   *
   */
  async isTxSettled(txHash, txOutputIndex, isMaker) {
    const tradeParty = isMaker ? 'maker' : 'taker';
    const tradeKey = `settle.tx.${txHash}.${txOutputIndex}.${tradeParty}`;
    debugSettle(`searching for ${tradeKey}`);
    try {
      // 0 edge case
      let output = await this._persistence.getOutputByHashAndIndex(txHash, txOutputIndex);
      if (!output) {
        const block = await this._persistence.getBlockByTxHash(txHash);
        if (block && block.getTxsList) {
          let txs = block.getTxsList().filter(tx => {
            return tx.getHash() === txHash;
          });
          if (txs.length === 1) {
            await this._persistence.putTransaction(txs[0], block.getHash(), 0, 'bc');
            output = await this._persistence.getOutputByHashAndIndex(txHash, txOutputIndex);
            if (!output) {
              debugSettle(`unable to get tx hash from ${txHash} after local storage update`);
              return false;
            }
          } else {
            debugSettle(`unable to get get tx hash from ${txHash} after parent block search`);
            return false;
          }
        } else {
          debugSettle(`unable to get tx hash from ${txHash}`);
          return false;
        }
      }
      const [makerScript, _, __] = await this.getInitialMakerOrder(toASM(Buffer.from(output.getOutputScript()), 0x01), 0);
      let makerOrder = parseMakerLockScript(makerScript);
      let shiftAmount = isMaker ? makerOrder.shiftMaker : makerOrder.shiftTaker;

      const { receivesUnit, sendsUnit } = parseMakerLockScript(makerScript);
      if (receivesUnit === '0' && !isMaker) return true;
      if (sendsUnit === '0' && isMaker) return true;

      const markedKey = await this._persistence.get(tradeKey);

      debugSettle(`marked key for ${tradeKey} is ${markedKey}`);

      if (!markedKey) {
        return false;
      }

      const checkTradeKey = await this._persistence.get(markedKey);

      if (tradeKey !== checkTradeKey) return false;

      let [, bcHeight, childChainId, childChainHeight,, markedTxHash] = markedKey.split('.');
      if (bcHeight.split(',').length > 4) {
        bcHeight = bcHeight.split(',')[4];
      }
      if (wasabiBulletProofs.includes(markedTxHash)) return false;

      const bcBlock = await this._persistence.getBlockByHeight(bcHeight);
      const bcBlockNext = await this._persistence.getBlockByHeight(parseInt(bcHeight) + 1);

      // found the marked key, double check it is actually within the appropriate BC block and its child block
      for (let block of [bcBlock, bcBlockNext]) {
        if (block) {
          for (const childBlock of getChildBlocks(block, childChainId.toLowerCase())) {
            if (childBlock.getHeight() === Number(childChainHeight)) {
              for (const markedTx of childBlock.getMarkedTxsList()) {
                if (markedTx.getHash() === markedTxHash) {
                  let pastShift = await this._persistence.isRoveredBlockPastShift(childBlock.getHash(), childBlock.getHeight(), childChainId, shiftAmount + 1);
                  debugSettle(`shift for ${tradeKey} is ${pastShift}`);
                  if (pastShift === -1 || pastShift === false) {
                    return false;
                  } else {
                    return true;
                  }
                }
              }
            }
          }
        }
      }
      this._logger.info(`couldn't find block ${childChainId} at ${childChainHeight}`);
      return false;
    } catch (err) {
      // this._logger.error(`error with ${txHash}, ${txOutputIndex}, ${isMaker}`)
      this._logger.error(err);
      return false;
    }
  }

  /**
   * Checks if the tx settlement is over
   */
  async isTxWithinSettlement(txHash, txOutputIndex, latest, onlyMaker = false) {
    try {
      // should be the taker tx hash
      const tx = await this._persistence.getTransactionByHash(txHash);
      const block = await this._persistence.getBlockByTxHash(txHash); // getOutputByHashAndIndex
      let latestBlock = latest;
      if (!latestBlock) latestBlock = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.last.utxoSaved`);

      if (!tx || !block || !latestBlock) {
        return false;
      }

      if (latestBlock.getHeight() === 2922059 && txHash === 'dde030f38b19275e4d5e9e8a27b652e9fecb9013b59917e3b80aefc34de1fe2d') return false;

      // the original maker order
      const outputScript = toASM(Buffer.from(tx.getOutputsList()[txOutputIndex].getOutputScript()), 0x01);
      const [originalScript, originalBlockHeight, originalMakerTxOutput] = await this.getInitialMakerOrder(outputScript, block.getHeight());

      const { settlement, shiftMaker, shiftTaker, receivesToChain, sendsFromChain } = parseMakerLockScript(originalScript);

      // console.log({settlement,shiftMaker,shiftTaker});
      // if the latest block height is below the settlement, we are within the window
      if (originalBlockHeight + settlement > latestBlock.getHeight()) {
        return true;
      } else {
        // check to see if the taker/maker is within the shift window
        // block at which tx settlement ends
        const settleBlock = await this._persistence.getBlockByHeight(originalBlockHeight + settlement);

        const lastestChildMaker = last(getChildBlocks(latestBlock, sendsFromChain)).getHeight();
        const lastestChildTaker = last(getChildBlocks(latestBlock, receivesToChain)).getHeight();
        const settleChildMaker = last(getChildBlocks(settleBlock, sendsFromChain)).getHeight() + parseFloat(shiftMaker) + 1;
        const settleChildTaker = last(getChildBlocks(settleBlock, receivesToChain)).getHeight() + parseFloat(shiftTaker) + 1;
        // console.log({settleChildMaker,lastestChildMaker})
        if (onlyMaker) {
          if (settleChildMaker <= lastestChildMaker) {
            return false;
          } else {
            return true;
          }
        } else {
          let takerDetails = await this.getChildChainDetailsForOrder(txHash, txOutputIndex, false);
          let makerDetails = await this.getChildChainDetailsForOrder(txHash, txOutputIndex, true);

          // taker order is still within shift
          if (takerDetails) {
            if (takerDetails.childBlock) {
              let pastShiftTaker = await this._persistence.isRoveredBlockPastShift(takerDetails.childBlock.getHash(), takerDetails.childBlock.getHeight(), takerDetails.childBlock.getBlockchain(), takerDetails.shiftAmount + 1, latestBlock);
              if (pastShiftTaker === 0) return true;
            }
          }

          // maker order is still within shift
          if (makerDetails) {
            if (makerDetails.childBlock) {
              let pastShiftMaker = await this._persistence.isRoveredBlockPastShift(makerDetails.childBlock.getHash(), makerDetails.childBlock.getHeight(), makerDetails.childBlock.getBlockchain(), makerDetails.shiftAmount + 1, latestBlock);
              if (pastShiftMaker === 0) return true;
            }
          }

          if (settleChildMaker <= lastestChildMaker && settleChildTaker <= lastestChildTaker) {
            return false;
          } else {
            return true;
          }
        }
      }
    } catch (err) {
      throw new Error(err);
    }
  }

  _sortTrades(trades) {
    trades.sort((a, b) => {
      let [,, ablockHeight, aCollateral] = a.split('.');
      let [,, bblockHeight, bCollateral] = b.split('.');
      if (new Decimal(ablockHeight).lt(new Decimal(bblockHeight))) {
        return -1;
      } else if (new Decimal(ablockHeight).gt(new Decimal(bblockHeight))) {
        return 1;
      } else {
        return new Decimal(aCollateral).gte(new Decimal(bCollateral)) ? -1 : 1;
      }
    });
  }

  // private
  async getChildChainDetailsForOrder(txHash, txOutputIndex, isMaker) {
    const tradeParty = isMaker ? 'maker' : 'taker';
    const tradeKey = `settle.tx.${txHash}.${txOutputIndex}.${tradeParty}`;
    if (!this._readEventTable['getChildChainDetailsForOrder']) {
      this._readEventTable['getChildChainDetailsForOrder'] = 0;
    }
    this._readEventTable['getChildChainDetailsForOrder']++;
    try {
      // 0 edge case
      const output = await this._persistence.getOutputByHashAndIndex(txHash, txOutputIndex);
      const [makerScript, _, __] = await this.getInitialMakerOrder(toASM(Buffer.from(output.getOutputScript()), 0x01), 0);
      let { receivesUnit, sendsUnit, shiftMaker, shiftTaker } = parseMakerLockScript(makerScript);
      let shiftAmount = isMaker ? shiftMaker : shiftTaker;

      // if (receivesUnit === '0' && !isMaker) return true
      // if (sendsUnit === '0' && isMaker) return true

      const markedKey = await this._persistence.get(tradeKey);

      if (!markedKey) {
        return false;
      }

      const checkTradeKey = await this._persistence.get(markedKey);

      if (tradeKey !== checkTradeKey) return false;

      let [, bcHeight, childChainId, childChainHeight,, markedTxHash] = markedKey.split('.');
      if (bcHeight.split(',').length > 4) {
        bcHeight = bcHeight.split(',')[4];
      }
      if (wasabiBulletProofs.includes(markedTxHash)) return false;

      const bcBlock = await this._persistence.getBlockByHeight(bcHeight);
      const bcBlockNext = await this._persistence.getBlockByHeight(parseInt(bcHeight) + 1);

      // found the marked key, double check it is actually within the appropriate BC block and its child block
      for (let block of [bcBlock, bcBlockNext]) {
        if (block) {
          for (const childBlock of getChildBlocks(block, childChainId.toLowerCase())) {
            if (childBlock.getHeight() === Number(childChainHeight)) {
              for (const markedTx of childBlock.getMarkedTxsList()) {
                if (markedTx.getHash() === markedTxHash) {
                  return { childBlock, shiftAmount };
                }
              }
            }
          }
        }
      }
      this._logger.info(`couldn't find block ${childChainId} at ${childChainHeight}, started check from bc height ${bcHeight}`);
      return false;
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  // private
  async setNrgMintedSoFar(nrg) {
    await this._persistence.put(NRG_MINTED_PERSISTENCE_KEY, nrg);
  }

  /**
   * Validates the rovered blocks matches blocks provided by the block returning true (yes) false (no)
   * @param block BcBlock||Block
   *
   * private
   */
  async putBlockPassesRoverTest(block, opts = { asBuffer: true, calledFrom: 'utxoManager' }) {
    debugWriteOperations(`putBlockPassesRoverTest(): ${block.getHeight()}- ${block.getHash()}`);
    if (!this._writeEventTable['putBlockPassesRoverTest']) {
      this._writeEventTable['putBlockPassesRoverTest'] = 0;
    }
    this._writeEventTable['putBlockPassesRoverTest']++;

    if (block && block.getHeight() > 7261764 && block.getHeight() < 7466800) {
      return true;
    }

    if (block && !block.getBlockchain) {
      const now = Number(Date.now());
      const elapsed = now - block.getTimestamp();
      const rovers = [];
      const headersMap = block.getBlockchainHeaders();
      const headersObj = this._persistence._getHeaderMapByBlock(block.getHash()) || headersMap.toObject();

      let headers = Object.keys(headersObj).reduce((all, listName) => {
        rovers.push(listName);
        const getMethodName = `get${listName[0].toUpperCase()}${listName.slice(1)}`;
        const chainHeaders = headersMap[getMethodName]();
        return all.concat(sortBlocks(chainHeaders));
      }, []);

      const headerTable = headers.reduce((all, h) => {
        if (h && h.getHash) {
          all[h.getHash()] = h;
        }
        return all;
      }, {});

      for (let h of headers) {
        const roveredHeaderMerkle = await this._persistence.get(`${h.getBlockchain()}.rovered.${h.getHash()}`);
        if (roveredHeaderMerkle) {
          const purposedMerkle = getMarkedTransactionsMerkle(h);
          if (roveredHeaderMerkle !== purposedMerkle && elapsed < 500000) {
            const edge = await this.persistence.get(`${BC_SUPER_COLLIDER}.sync.edge`);
            const currentLatest = await this._persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);

            if (edge && currentLatest && parseInt(edge + 100, 10) < parseInt(currentLatest.getHeight(), 10) && parseInt(block.getHeight(), 10) > 8782183) {
              this._logger.warn(`rover found malformed child ${h.getBlockchain()} in proposed ${BC_SUPER_COLLIDER} ${block.getHeight()}...`);
              this._logger.warn(`purposed: ${purposedMerkle} !== rovered: ${roveredHeaderMerkle} elapsed: ${elapsed}`);
              const j = h.toObject();
              this._logger.info(`purposed: ${h.getHash()} not on disk...`);
              //console.log(JSON.stringify(j, null, 2))
              const jh = await this._persistence.getBlockByHash(h.getHash(), h.getBlockchain());
              if (jh) {
                this._logger.info(`purposed: ${h.getHash()} on disk...`);
                //console.log(JSON.stringify(jh.toObject(), null, 2))
              }
              if (parseInt(block.getHeight(), 10) > 7911000) {
                return false;
              }
            } else {
              this._logger.info(`local block ${parseInt(block.getHeight(), 10)} mount is after stale threshold latest: ${parseInt(currentLatest.getHeight(), 10)}`);
            }
          }
        }
      }

      for (let r of rovers) {
        const queryRaised = await this._persistence.get(`${r}.query`);
        if (queryRaised) {
          const blockHash = queryRaised.split(':')[0];
          const roveredMerkle = queryRaised.split(':')[1];

          if (headerTable[blockHash] !== undefined) {
            const purposedMerkle = getMarkedTransactionsMerkle(headerTable[blockHash]);
            if (purposedMerkle === roveredMerkle) {
              // query resolved
              this._logger.info(`${r} query resolved ${blockHash.slice(0, 21)}`);
              await this._persistence.del(`${r}.query`);
            } else {
              this._logger.warn(`rover discovered miss matching child ${r} in local block ...`);
              return false;
            }
          }
        }
      }
      this._persistence._setHeaderMapByBlock(block.getHash(), headersObj);
      return true;
    } else {
      this._logger.warn(`putBlockPassesRoverTest(): function is only for super collider blocks: ${BC_SUPER_COLLIDER}`);
      return true;
    }
  }

  /**
   * Get the original maker script and height for a callback script
   *
   */
  async getInitialMakerOrder(outputScript, blockHeight = 0) {
    if (!this._readEventTable['getInitialMakerOrder']) {
      this._readEventTable['getInitialMakerOrder'] = 0;
    }
    this._readEventTable['getInitialMakerOrder']++;
    const [resultOutputScript, resultBlockHeight,,, _makerTxOutput] = await this._getInitialMakerOrderData(outputScript, blockHeight);
    return [resultOutputScript, resultBlockHeight, _makerTxOutput];
  }

  /**
   * Get the original maker script and height for a callback script with the tx hash and index
   *
   */
  async getInitialMakerOrderWithTxAndIndex(outputScript, blockHeight = 0) {
    if (!this._readEventTable['getInitialMakerOrderWithTxAndIndex']) {
      this._readEventTable['getInitialMakerOrderWithTxAndIndex'] = 0;
    }
    this._readEventTable['getInitialMakerOrderWithTxAndIndex']++;
    const [resultOutputScript, resultBlockHeight, tx, txOutputIndex] = await this._getInitialMakerOrderData(outputScript, blockHeight);
    return [resultOutputScript, resultBlockHeight, tx, txOutputIndex];
  }

  // private
  async _getInitialMakerOrderData(outputScript, blockHeight = 0) {
    let _makerTxOutput = null;
    let tx;
    let txOutputIndex;
    let parentTxHash = null;
    let parentOutputIndex = 0;
    while (outputScript.includes('OP_CALLBACK')) {
      const str = outputScript.split(' ');
      parentTxHash = str[0];
      parentOutputIndex = str[1];
      const _makerTx = await this._persistence.getTransactionByHash(parentTxHash, 'bc');
      _makerTxOutput = _makerTx.getOutputsList()[parentOutputIndex];
      outputScript = toASM(Buffer.from(_makerTxOutput.getOutputScript()), 0x01);
      tx = _makerTx;
      txOutputIndex = parentOutputIndex;
    }
    if (parentTxHash) {
      const block = await this._persistence.getBlockByTxHash(parentTxHash);
      if (block) blockHeight = block.getHeight();
    }
    const res = [outputScript, blockHeight, tx, txOutputIndex, _makerTxOutput];
    return res;
  }

  /**
   * Add unspent outpoint from tx output
   *
   * private
   */
  async addUTXO(scriptType, utxos, block) {

    let date = Date.now();
    if (utxos.length === 0) return true;

    // the scriptType is defined by the transaction script arguments
    let length = await this.getUtxosLength(scriptType);
    let oldLength = await this._persistence.get(`utxo.${scriptType}.length.${block.getHash()}`);

    if (oldLength) {
      debugUTXODetail(`using oldLength ${oldLength} vs length ${length} for ${block.getHash()}:${block.getHeight()}`);
      length = oldLength;
    } else {
      await this._persistence.put(`utxo.${scriptType}.length.${block.getHash()}`, length);
    }

    // TD this needs to be replaced as it increments the number of utxos at a fixed rate preventing branches of potentially valid UTXOs at the same height
    let count = await this.getUtxosCount(scriptType);

    // cost 0.7 seconds
    let { utxoToAddresses, addresses } = await this.extractAddressesFromUtxos(scriptType, utxos.map(({ index, tx }) => {
      return { txHash: tx.getHash(), index, script: tx.getOutputsList()[index].getOutputScript() };
    }));
    debugUTXO(`addUTXO(): section 1 ${Math.floor(Date.now() - date)}`);

    for (const u of utxos) {
      const { index, tx, hash, height } = u;

      // add key for marked transactions for this taker order
      if (scriptType === 'taker_output') await this.updateTradeIndex({ tx, index }, block, false);

      const utxo = this.buildUtxo(tx, index, block, hash, height);
      debugUTXO(`addUTXO(): section 2 ${Math.floor(Date.now() - date)}ms`);

      // if this key does not exists it means the outpoint has not been spent and so it is added
      const utxoIndex = await this._persistence.get(`opunspent.${tx.getHash()}.${index}`);
      if (!utxoIndex) {
        await this._persistence.put(`utxo.${scriptType}.${length}`, utxo);
        await this._persistence.put(`opunspent.${tx.getHash()}.${index}`, length);

        // TD if this key does exist the utxo has already been added
      } else {
        debugUTXO(`setting length to ${utxoIndex}`);
        length = utxoIndex;
      }
      for (let addr of utxoToAddresses[`${tx.getHash()}.${index}`]) {
        let arrIndex = addresses[addr].indexOf(length);
        debugAddress(`address ${addr}.${scriptType} added ${length}`);
        if (arrIndex === -1) {
          addresses[addr].push(length);
        }
      }

      length++;
      count++;
      // cost 0.6 seconds
      debugUTXO(`addUTXO(): section 3 ${Math.floor(Date.now() - date)}ms`);
    }

    const indexes = [];
    // update addr -> utxoIndexes
    for (const addr of Object.keys(addresses)) {
      await this._persistence.put(`${addr}.${scriptType}`, [...new Set(addresses[addr])]);
      await this._persistence.put(`address.last.${addr}`, block.getHash());
    }

    debugUTXO(`addUTXO(): section 4 ${Math.floor(Date.now() - date)}`);

    await this._persistence.put(`utxo.${scriptType}.length`, length);
    await this._persistence.put(`utxo.${scriptType}.count`, count);
    debugUTXODetail(`utxo.${scriptType}.length is ${length}`);
    debugUTXODetail(`utxo.${scriptType}.count is ${count}`);

    return true;
  }

  // private
  buildUtxo(tx, index, block, hash, height) {
    const arr = [tx.getOutputsList()[index].toObject(), tx.getHash(), index, hash || block.getHash(), height || block.getHeight(), tx.getInputsList().length == 0];
    const utxo = new Utxo(arr);
    utxo.setOutput(tx.getOutputsList()[index]);
    return utxo;
  }

  /**
   * Add unspent outpoint from tx output
   *
   * private
   */
  async delUTXO(scriptType, utxos, block) {

    if (utxos.length === 0) return true;
    let date = Date.now();
    let count = await this.getUtxosCount(scriptType);

    let { utxoToAddresses, addresses } = await this.extractAddressesFromUtxos(scriptType, utxos.map(({ index, tx }) => {
      return { txHash: tx.getHash(), index, script: tx.getOutputsList()[index].getOutputScript() };
    }));
    debugUTXO(`delUTXO(): section 1D ${Math.floor((Date.now() - date) / 1000)}`);

    let dels = [];
    let nextDels = [];

    for (let i = 0; i < utxos.length; i++) {
      const { index, tx, hash, height } = utxos[i];

      // add key for marked transactions for this taker order
      if (scriptType === 'taker_output') await this.updateTradeIndex({ tx, index }, block, true);
      debugUTXO(`delUTXO(): section 2D ${Math.floor((Date.now() - date) / 1000)}`);
      let utxoIndex = await this._persistence.get(`opunspent.${tx.getHash()}.${index}`);
      if (utxoIndex >= 0) {
        if (!OL_FAST_SYNC) {
          for (let addr of utxoToAddresses[`${tx.getHash()}.${index}`]) {
            let arr = addresses[addr];
            let arrIndex = arr.indexOf(utxoIndex);
            debugAddress(`address ${addr}.${scriptType} removed ${utxoIndex}`);
            if (arrIndex !== -1) {
              arr.splice(arrIndex, 1);
              addresses[addr] = arr;
            }
          }
        }
        dels.push(`utxo.${scriptType}.${utxoIndex}`);
        debugSpending(`spending opunspent.${tx.getHash()}.${index}`);
        nextDels.push(`opunspent.${tx.getHash()}.${index}`); // txHash.txIndex -> index
        count = count - 1;
      } else {
        debugUTXODetail(`utxo not saved saved for ${tx.getHash()}.${index}`);
      }
    }

    // update addr -> utxoIndexes

    if (!OL_FAST_SYNC) {
      for (const addr of Object.keys(addresses)) {
        await this._persistence.put(`${addr}.${scriptType}`, [...new Set(addresses[addr])]);
        await this._persistence.put(`address.last.${addr}`, block.getHash());
      }
    }
    debugUTXO(`delUTXO(): section 3D ${Math.floor((Date.now() - date) / 1000)}`);

    await this._persistence.put(`utxo.${scriptType}.count`, count);

    for (const del of dels) {
      await this._persistence.del(del);
    }

    for (const del of nextDels) {
      await this._persistence.del(del);
    }

    debugUTXODetail(`utxo.${scriptType}.count is ${count}`);

    return true;
  }

  async viewUTXOs() {
    debugUTXO('calling cleanup');
    let date = Date.now();
    // save each utxo for each script type
    const utxos = {
      nrg_transfer: [],
      maker_output: [],
      taker_output: [],
      taker_callback: [],
      feed_update: [],
      feed_create: []
    };
    for (let i = 0; i < Object.keys(utxos).length; i++) {
      let scriptType = Object.keys(utxos)[i];
      const length = await this.getUtxosLength(scriptType);
      let count = await this.getUtxosCount(scriptType);

      let nullIndexes = [];
      let fullIndexes = [];
      let notFound = [];
      // collect all null and full indexes
      for (let j = 0; j < length; j++) {
        let utxo = await this._persistence.get(`utxo.${scriptType}.${j}`);
        if (!utxo) {
          nullIndexes.push(j);
        } else {
          fullIndexes.push({ index: j, utxo });
          let tx = await this._persistence.getTransactionByHash(utxo.getTxHash());
          if (!tx) {
            notFound.push({ index: j, utxo });
          }
        }
      }

      let { utxoToAddresses, addresses } = await this.extractAddressesFromUtxos(scriptType, notFound.map(({ utxo }) => {
        return { txHash: utxo.getTxHash(), index: utxo.getTxIndex(), script: utxo.getOutput().getOutputScript() };
      }));

      // replace the null indexes with full indexes if null Index < fullIndex
      for (let j = 0; j < notFound.length; j++) {
        let { utxo, index } = notFound[j];
        let txHash = utxo.getTxHash();
        let txIndex = utxo.getTxIndex();

        for (let addr of utxoToAddresses[`${txHash}.${txIndex}`]) {
          let arr = addresses[addr];
          let arrIndex = arr.indexOf(index);
          if (arrIndex !== -1) {
            arr.splice(arrIndex, 1);
            addresses[addr] = arr;
          }
        }
        count--;
        await this._persistence.del(`utxo.${scriptType}.${index}`);
        await this._persistence.del(`opunspent.${tx.getHash()}.${txIndex}`); // txHash.txIndex -> index
      }

      await this._persistence.put(`utxo.${scriptType}.count`, count);

      for (const addr of Object.keys(addresses)) {
        //puts.push([`${addr}.${scriptType}`, [...new Set(addresses[addr])]])
        await this._persistence.put(`${addr}.${scriptType}`, [...new Set(addresses[addr])]);
      }
    }
    debugUTXO(`clean up took ${Date.now() - date} ms`);
  }

  async getUtxos(scriptType, opts = { from: null, to: null, address: false }) {
    // debugReadOperations(`getUtxos()`)
    if (!this._readEventTable['getUtxos']) {
      this._readEventTable['getUtxos'] = 0;
    }
    this._readEventTable['getUtxos']++;

    let keys = [];
    if (opts.address) {
      let indexes = await this.getUtxoIndexesByAddress(scriptType, opts.address);
      if (indexes && indexes.length) {
        debugUTXO(`getUtxos(): indexes ${indexes.length}`);
      }

      const length = indexes.length;
      const from = opts.from && opts.from < length ? opts.from : 0;
      const to = opts.to && opts.to < length ? opts.to : length;

      for (let i = from; i < to; i++) {
        keys.push(`utxo.${scriptType}.${indexes[i]}`);
      }
    } else {
      const length = await this.getUtxosLength(scriptType);
      const from = opts.from && opts.from < length ? opts.from : 0;
      const to = opts.to && opts.to < length ? opts.to : length;

      for (let i = from; i < to; i++) {
        keys.push(`utxo.${scriptType}.${i}`);
      }
    }
    let utxos = await this._persistence.getBulk(keys);
    utxos = utxos.filter(u => {
      return u != null;
    });
    return { utxos, scriptType };
  }

  // private
  async getUtxosCount(scriptType, address) {
    if (!this._readEventTable['getUtxosCount']) {
      this._readEventTable['getUtxosCount'] = 0;
    }
    this._readEventTable['getUtxosCount']++;
    if (address === null || address === undefined || address === '') {
      let length = await this._persistence.get(`utxo.${scriptType}.count`);
      if (!length) length = await this._persistence.get(`utxo.${scriptType}.length`);
      return length || 0;
    } else {
      address = '0x' + blake2bl(blake2bl(address.toLowerCase()) + address.toLowerCase());
      const indexes = await this._persistence.get(`${address}.${scriptType}`);
      return indexes ? indexes.length : 0;
    }
  }

  /**
   * Index trade's send/recieve data to be easily looked up to add marked txs
   * @param utxo Object
   * @param block BcBlock
   * @param remove bool
   *
   * private
   */
  async updateTradeIndex(utxo, block, remove) {
    try {
      let date = Date.now();
      const { tx, index } = utxo;
      const txHash = tx.getHash();
      const script = toASM(Buffer.from(tx.getOutputsList()[index].getOutputScript()), 0x01);
      const { makerTxHash, makerTxOutputIndex } = parseTakerLockScript(script);
      const [originalScript, blockHeight, makerOutput] = await this.getInitialMakerOrder(script);
      const inputs = tx.getInputsList();
      debugUTXO(`updateTradeIndex(): section 1M ${Math.floor((Date.now() - date) / 1000)}`);

      if (!remove) {
        await this._persistence.put(`maker.${makerTxHash}.${makerTxOutputIndex}`, `${txHash}.${index}`);
      } else {
        await this._persistence.del(`maker.${makerTxHash}.${makerTxOutputIndex}`);
      }

      for (const input of inputs) {
        //for (let i = 0; i < inputs.length; i++) {
        //  const input = inputs[i]
        const outPoint = input.getOutPoint();
        if (outPoint.getHash() === makerTxHash && outPoint.getIndex() === makerTxOutputIndex) {
          const inputScript = input.getInputScript();
          let {
            receivesToAddress,
            receivesToChain,
            receivesUnit,
            sendsFromAddress,
            sendsFromChain,
            sendsUnit,
            base
          } = parseMakerLockScript(originalScript);
          const [makerSendsFrom, makerReceivesTo] = [sendsFromAddress, receivesToAddress];
          const taker = parseTakerUnlockScript(toASM(Buffer.from(inputScript), 0x01));
          const [takerSendsFrom, takerReceivesTo] = [taker.sendsFromAddress, taker.receivesToAddress];
          const numer = new Decimal(internalToHuman(makerOutput.getValue(), NRG));
          const denom = new Decimal(internalToHuman(tx.getOutputsList()[index].getValue(), NRG));
          const ratio = denom.div(numer);

          receivesUnit = new Decimal(receivesUnit).mul(ratio).div(new Decimal(base)).toString();
          sendsUnit = new Decimal(sendsUnit).mul(ratio).div(new Decimal(base)).toString();

          const makerKey = `${makerSendsFrom}.${takerReceivesTo}.${sendsFromChain}.${sendsUnit}`;
          const takerKey = `${takerSendsFrom}.${makerReceivesTo}.${receivesToChain}.${receivesUnit}`;
          const keys = [makerKey, takerKey];
          const type = ['maker', 'taker'];

          const val = new BN(makerOutput.getValue()).toString();

          for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            let hashes = await this._persistence.get(key);
            if (remove) {
              if (hashes) {
                const check = hashes.indexOf(`${txHash}.${index}.${block.getHeight()}.${val}.${type[i]}`);
                if (check > -1) {
                  hashes.splice(check, 1);
                  await this._persistence.put(key, hashes);
                }
              }
            } else {
              if (!hashes) {
                hashes = [`${txHash}.${index}.${block.getHeight()}.${val}.${type[i]}`];
                debugUTXO(`${key} = ${hashes}`);
                await this._persistence.put(key, hashes);
              } else if (hashes.indexOf(`${txHash}.${index}.${block.getHeight()}.${val}.${type[i]}`) === -1) {
                hashes.push(`${txHash}.${index}.${block.getHeight()}.${val}.${type[i]}`);
                debugUTXO(`${key} = ${hashes}`);
                await this._persistence.put(key, hashes);
              }
            }
            debugUTXO(`updateTradeIndex(): section 2M ${Math.floor((Date.now() - date) / 1000)}`);
          }
          break;
        }
      }
      return true;
    } catch (err) {
      this._logger.error(err);
      return false;
    }
  }

  // private
  async extractAddressesFromUtxos(scriptType, utxos) {
    let addresses = new Set();
    const utxoToAddresses = {};
    if (OL_FAST_SYNC) {
      return { utxoToAddresses, addresses: {} };
    }
    for (let _ref of utxos) {
      let { txHash, index, script } = _ref;

      script = toASM(Buffer.from(script), 0x01);
      let addr = new Set();
      if (scriptType === ScriptType.NRG_TRANSFER) {
        addr.add(script.split(' ')[1]);
      } else if (scriptType === ScriptType.MAKER_OUTPUT) {
        addr.add(parseMakerLockScript(script).doubleHashedBcAddress);
      } else if (scriptType === ScriptType.TAKER_OUTPUT) {
        const [originalScript, blockHeight, makerOutput] = await this.getInitialMakerOrder(script);
        addr.add(parseMakerLockScript(originalScript).doubleHashedBcAddress);
        addr.add(parseTakerLockScript(script).doubleHashedBcAddress);
      } else if (scriptType === ScriptType.TAKER_CALLBACK) {
        const [originalScript, blockHeight, makerOutput] = await this.getInitialMakerOrder(script);
        addr.add(parseMakerLockScript(originalScript).doubleHashedBcAddress);
      }
      addr = Array.from(addr);
      for (const a of addr) {
        addresses.add(a);
      }
      utxoToAddresses[`${txHash}.${index}`] = addr;
    }

    addresses = Array.from(addresses);
    const utxoIndexes = await Promise.all(addresses.map(a => {
      return this.getUtxoIndexesByAddress(scriptType, a, true);
    }));
    return { utxoToAddresses, addresses: zipObj(addresses, utxoIndexes) };
  }

  // private
  async getUtxoIndexesByAddress(scriptType, address, hashed) {
    if (!hashed) address = '0x' + blake2bl(blake2bl(address.toLowerCase()) + address.toLowerCase());
    if (!this._readEventTable['getUtxoIndexesByAddress']) {
      this._readEventTable['getUtxoIndexesByAddress'] = 0;
    }
    this._readEventTable['getUtxoIndexesByAddress']++;
    debugUTXO(`get utxo indexes: ${address} for ${scriptType}`);
    const indexes = await this._persistence.get(`${address}.${scriptType}`);
    if (indexes && indexes.length) {
      debugUTXO(`get utxo indexes: ${indexes.length}`);
    }
    return indexes ? indexes : [];
  }
}

module.exports = { UtxoManager };