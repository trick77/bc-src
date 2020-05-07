'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/*
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const BN = require('bn.js');
const debug = require('debug')('bcnode:wallet');

const { getLogger } = require('../logger');
const { blake2bl } = require('../utils/crypto');
const TxPendingPool = require('../bc/txPendingPool');
const { createOutPoint } = require('bcjs/dist/utils/protoUtil');
const {
  internalToBN,
  internalToHuman,
  COIN_FRACS: { BOSON, NRG }
} = require('../core/coin');
const { OutPoint, WalletOutPoint, WalletData } = require('../protos/core_pb');
const { TransferResponse, Transfer } = require('../protos/bc_pb');
const { toASM, fromASM } = require('bcjs/dist/script/bytecode');
const { getScriptType, ScriptType } = require('bcjs/dist/script/templates');
const { MakerOrderInfo } = require('../protos/bc_pb');
const {
  BC_COINBASE_MATURITY,
  getTxOwnerHashed,
  parseMakerLockScript
} = require('../core/txUtils');

const MAKER_TAKER_SETTLED = 1;
const ONLY_MAKER_SETTLED = 2;
const ONLY_TAKER_SETTLED = 3;
const STILL_IN_SETTLEMENT = 4;

const hasAddressInScript = exports.hasAddressInScript = (script, address) => {
  const asBlakePowered = blake2bl(blake2bl(address.toLowerCase()) + address.toLowerCase());
  return script.indexOf(asBlakePowered) > -1;
};

class Wallet {

  constructor(persistence, txPendingPool) {
    this._persistence = persistence;
    this._txPendingPool = txPendingPool;
    this._logger = getLogger(__filename);
  }

  // these will return all unmatched orders that have not been unlocked
  async getUnmatchedOrders(address) {
    address = address.toLowerCase();
    let wallet = await this.calculateWalletUTXO(address);
    let orders = [];
    // these contain maker orders that were not taken
    orders = await Promise.all(wallet.getCollateralizedUnmatchedOutpointsList().map(order => {
      return this.extractMakerOrder(order);
    }));

    for (let order of wallet.getCollateralizedSpendableOutpointsList()) {
      if (getScriptType(order.getOriginalScript()) === ScriptType.MAKER_OUTPUT) {
        if (order.getCallbackScript() && getScriptType(order.getCallbackScript()) === ScriptType.TAKER_OUTPUT) {
          continue;
        } else {
          let makerOrder = await this.extractMakerOrder(order);
          makerOrder.setIsSettled(true);
          orders.push(makerOrder);
        }
      }
    }
    return orders;
  }

  removeTxPendingPoolOutpoints(wallet, from, to) {
    let confirmedOutpoints = wallet.getSpendableOutpointsList().filter(outpoint => {
      return !this._txPendingPool.isBeingSpent(outpoint.getOutpoint());
    }).filter((_, i) => {
      return i >= from && i <= to;
    });
    wallet.setSpendableOutpointsList(confirmedOutpoints);
  }

  async getWalletData(address, from, to) {
    let wallet = await this.calculateWalletUTXO(address.toLowerCase());
    return wallet;
  }

  async getSpendableOutpointsList(address, from, to) {
    if (!from) from = 0;
    if (!to) to = 1000;
    if (to < from || to - from > 1000 || to - from === 0) to = from + 1000;
    let wallet = await this.calculateWalletSpendable(address.toLowerCase());
    this.removeTxPendingPoolOutpoints(wallet, from, to);
    return wallet;
  }

  async getBalanceData(address) {
    let wallet = await this.calculateWalletUTXO(address.toLowerCase());
    return this.processWallet(wallet);
  }

  processWallet(wallet) {
    let reduceAdd = (all, curr) => {
      return all.add(new BN(curr.getOutpoint().getValue()));
    };

    const accountBalances = {
      confirmed: internalToHuman(wallet.getSpendableOutpointsList().reduce(reduceAdd, new BN(0)), NRG),
      unconfirmed: internalToHuman(wallet.getUnconfirmedSpendableOutpointsList().reduce(reduceAdd, new BN(0)), NRG),
      collateralized: internalToHuman(wallet.getCollateralizedMakerOutpointsList().concat(wallet.getCollateralizedUnmatchedOutpointsList()).concat(wallet.getCollateralizedMatchedOutpointsList()).reduce(reduceAdd, new BN(0)), NRG),
      unlockable: internalToHuman(wallet.getCollateralizedSpendableOutpointsList().reduce(reduceAdd, new BN(0)), NRG)
    };
    return accountBalances;
  }

  async calculateWalletSpendable(address) {
    if (address) address = address.toLowerCase();
    const latestBlock = await this._persistence.get(`bc.block.latest`);
    let { utxos } = await this._persistence.getUtxos(ScriptType.NRG_TRANSFER, { address });
    const accountBalances = {
      unconfirmedSpendableOutPoints: [],
      spendableOutPoints: []
    };

    await Promise.all(utxos.map(utxo => {
      let hash = utxo.getTxHash();
      let index = utxo.getTxIndex();
      let blockHeight = utxo.getBlockHeight();
      const output = utxo.getOutput();
      const outputScript = toASM(Buffer.from(output.getOutputScript()), 0x01);
      const coinbase = utxo.getCoinbase();
      return this.processTransfer(blockHeight, latestBlock.getHeight(), address, hash, index, output, outputScript, coinbase, accountBalances);
    }));

    let newWallet = new WalletData();
    newWallet.setUnconfirmedSpendableOutpointsList(accountBalances.unconfirmedSpendableOutPoints);
    newWallet.setSpendableOutpointsList(accountBalances.spendableOutPoints);

    return newWallet;
  }

  async calculateWalletUTXO(address) {
    address = address.toLowerCase();
    const latestBlock = await this._persistence.get(`bc.block.latest`);
    const accountBalances = {
      unconfirmedSpendableOutPoints: [],
      spendableOutPoints: [],
      collateralizedMakerOutPoints: [],
      collateralizedUnmatchedOutPoints: [],
      collateralizedMatchedOutPoints: [],
      collateralizedSpendableOutPoints: []
    };

    let processFuncs = {};
    processFuncs[ScriptType.NRG_TRANSFER] = `processTransfer`;
    processFuncs[ScriptType.MAKER_OUTPUT] = `processMakerOrder`;
    processFuncs[ScriptType.TAKER_CALLBACK] = `processTakerCallback`;
    processFuncs[ScriptType.TAKER_OUTPUT] = `processTakerOrder`;

    let values = await Promise.all(Object.keys(processFuncs).map(scriptType => {
      return this._persistence.getUtxos(scriptType, { address });
    }));

    let j = 0;
    let promises = [];
    for (const scriptType of Object.keys(processFuncs)) {
      let { utxos } = values[j];

      let runs = utxos.map((utxo, i) => {
        let hash = utxo.getTxHash();
        let index = utxo.getTxIndex();
        let blockHeight = utxo.getBlockHeight();
        const output = utxo.getOutput();
        const outputScript = toASM(Buffer.from(output.getOutputScript()), 0x01);
        const coinbase = utxo.getCoinbase();
        promises.push(this[processFuncs[scriptType]](blockHeight, latestBlock.getHeight(), address, hash, index, output, outputScript, coinbase, accountBalances));
      });

      j++;
    }

    await Promise.all(promises);

    let newWallet = new WalletData();
    newWallet.setUnconfirmedSpendableOutpointsList(accountBalances.unconfirmedSpendableOutPoints);
    newWallet.setSpendableOutpointsList(accountBalances.spendableOutPoints);
    newWallet.setCollateralizedMakerOutpointsList(accountBalances.collateralizedMakerOutPoints);
    newWallet.setCollateralizedUnmatchedOutpointsList(accountBalances.collateralizedUnmatchedOutPoints);
    newWallet.setCollateralizedMatchedOutpointsList(accountBalances.collateralizedMatchedOutPoints);
    newWallet.setCollateralizedSpendableOutpointsList(accountBalances.collateralizedSpendableOutPoints);

    return newWallet;
  }

  async processTransfer(blockHeight, latestHeight, address, hash, index, output, outputScript, coinbase, accountBalances) {
    if (hasAddressInScript(outputScript, address)) {
      const op = createOutPoint(hash, index, new BN(output.getValue()));
      const wpo = new WalletOutPoint();
      wpo.setBlockHeight(blockHeight);
      wpo.setOriginalScript(output.getOutputScript());
      wpo.setOutpoint(op);
      if (coinbase && blockHeight + BC_COINBASE_MATURITY > latestHeight) {
        accountBalances.unconfirmedSpendableOutPoints.push(wpo);
      } else {
        accountBalances.spendableOutPoints.push(wpo);
      }
    }
  }

  async processMakerOrder(blockHeight, latestHeight, address, hash, index, output, outputScript, coinbase, accountBalances) {
    if (hasAddressInScript(outputScript, address)) {
      const { deposit, settlement } = parseMakerLockScript(outputScript);
      const op = createOutPoint(hash, index, new BN(output.getValue()));
      const wpo = new WalletOutPoint();
      wpo.setBlockHeight(blockHeight);
      wpo.setOriginalScript(output.getOutputScript());
      wpo.setOutpoint(op);

      if (blockHeight + deposit > latestHeight) {
        accountBalances.collateralizedMakerOutPoints.push(wpo);
      } else if (blockHeight + settlement > latestHeight) {
        accountBalances.collateralizedUnmatchedOutPoints.push(wpo);
      } else {
        accountBalances.collateralizedSpendableOutPoints.push(wpo);
      }
    }
  }

  // TODO - make sure the right block is being passed
  async processTakerCallback(blockHeight, latestHeight, address, hash, index, output, outputScript, coinbase, accountBalances) {
    let [originalScript, blockHeight2, _] = await this._persistence.getInitialMakerOrder(outputScript, 1);
    await this.processMakerOrder(blockHeight2, latestHeight, address, hash, index, output, originalScript, coinbase, accountBalances);
  }

  async processTakerOrder(blockHeight, latestHeight, address, hash, index, output, outputScript, coinbase, accountBalances) {
    let [originalScript, blockHeight2, originalMakerTxOutput] = await this._persistence.getInitialMakerOrder(outputScript, blockHeight);
    let status = await this.tradeStatus(latestHeight, blockHeight2, originalScript, hash, index);
    const { base } = parseMakerLockScript(originalScript);
    let halfBN = internalToBN(output.getValue(), BOSON).div(new BN(base.toString()));

    const op = createOutPoint(hash, index, halfBN);
    const wpo = new WalletOutPoint();
    wpo.setBlockHeight(blockHeight2);
    wpo.setCallbackScript(output.getOutputScript());
    wpo.setOriginalScript(new Uint8Array(fromASM(originalScript, 0x01)));
    wpo.setOutpoint(op);

    if (status == STILL_IN_SETTLEMENT) {
      // maker
      if (hasAddressInScript(originalScript, address)) {
        accountBalances.collateralizedMatchedOutPoints.push(wpo);
      }
      // taker only has collateral if its a non nrg order
      if (base == 2 && hasAddressInScript(outputScript, address)) {
        accountBalances.collateralizedMatchedOutPoints.push(wpo);
      }
    } else if (status == MAKER_TAKER_SETTLED) {
      // maker
      if (base == 2 && hasAddressInScript(originalScript, address)) {
        accountBalances.collateralizedSpendableOutPoints.push(wpo);
      }
      // taker only has collateral if its a non nrg order
      if (hasAddressInScript(outputScript, address)) {
        accountBalances.collateralizedSpendableOutPoints.push(wpo);
      }
    } else {
      op.setValue(output.getValue());
      wpo.setOutpoint(op);
      // only maker or taker
      let script = status == ONLY_TAKER_SETTLED ? outputScript : originalScript;
      if (hasAddressInScript(script, address)) {
        accountBalances.collateralizedSpendableOutPoints.push(wpo);
      }
    }
  }

  async getTransferHistory(address, from, max = 20) {
    const blockchain = 'bc';
    address = address.toLowerCase();
    let blakeAddr = '0x' + blake2bl(blake2bl(address.toLowerCase()) + address.toLowerCase());
    let block;
    if (from === 'latest') {
      let lastAddressBlock = await this._persistence.get(`address.last.${blakeAddr}`);
      if (lastAddressBlock) block = await this._persistence.get(`${blockchain}.block.${lastAddressBlock}`);else block = await this._persistence.get(`${blockchain}.block.${from}`);
    } else {
      block = await this._persistence.get(`${blockchain}.block.${from}`);
    }
    if (!block) throw new Error('Latest block not found');
    let transfers = [];
    let numBlocks = 0;
    while (transfers.length < max && block && numBlocks < 100) {
      for (let tx of block.getTxsList()) {
        let owner = getTxOwnerHashed(tx);
        if (owner === '0x' + blake2bl(address)) owner = address;
        for (let j = 0; j < tx.getOutputsList().length; j++) {
          const output = tx.getOutputsList()[j];
          const outputScript = toASM(Buffer.from(output.getOutputScript()), 0x01);
          const outputType = getScriptType(output.getOutputScript());

          let transfer = new Transfer();
          transfer.setHeight(block.getHeight());
          transfer.setAmount(internalToHuman(output.getValue(), NRG));
          transfer.setTxHash(tx.getHash());
          transfer.setTxOutputIndex(j);
          transfer.setTimestamp(block.getTimestamp());

          // received nrg or placed maker/taker order
          if (hasAddressInScript(outputScript, address)) {
            if (outputType === ScriptType.NRG_TRANSFER) {
              transfer.setTo(address);
              transfer.setFrom(owner);
            } else if (outputType === ScriptType.MAKER_OUTPUT) {
              transfer.setTo('Maker');
              transfer.setFrom(address);
            } else if (outputType === ScriptType.TAKER_OUTPUT) {
              transfer.setAmount((parseFloat(internalToHuman(output.getValue(), NRG)) / parseFloat(2)).toString());
              transfer.setTo('Taker');
              transfer.setFrom(address);
            }
            transfers.push(transfer);
          } else if (owner === address && outputType === ScriptType.NRG_TRANSFER) {
            // sent nrg
            transfer.setFrom(address);
            transfer.setTo(outputScript.split(' ')[1]);
            transfers.push(transfer);
          }
        }
      }
      numBlocks++;
      block = await this._persistence.getBlockByHash(block.getPreviousHash(), 'bc', { cached: true });
    }

    let transferResponse = new TransferResponse();
    transferResponse.setTransfersList(transfers);
    return transferResponse;
  }

  async tradeStatus(latestHeight, blockHeight, makerScript, hash, index) {
    const { settlement } = parseMakerLockScript(makerScript);

    let isMakerWithinSettlement = await this._persistence.isTxWithinSettlement(hash, index, true);
    let isTakerWithinSettlement = await this._persistence.isTxWithinSettlement(hash, index, false);

    if (isMakerWithinSettlement || isTakerWithinSettlement) {
      return STILL_IN_SETTLEMENT;
    }

    const makerSettlesInfo = await this._persistence.isTxSettled(hash, index, true);
    const takerSettlesInfo = await this._persistence.isTxSettled(hash, index, false);

    // if both settled or neither settled
    if (makerSettlesInfo == takerSettlesInfo) {
      return MAKER_TAKER_SETTLED;
    } else if (makerSettlesInfo) {
      return ONLY_MAKER_SETTLED;
    } else if (takerSettlesInfo) {
      return ONLY_TAKER_SETTLED;
    }
  }

  async extractMakerOrder(wp) {
    let order = new MakerOrderInfo();
    let o = wp.getOutpoint();

    let outputScript = toASM(Buffer.from(wp.getOriginalScript()), 0x01);
    const makerInfo = parseMakerLockScript(outputScript);
    Object.keys(makerInfo).map(key => {
      order[`set${key[0].toUpperCase()}${key.slice(1)}`](makerInfo[key]);
    });
    let ratio = new BN(1);

    if (wp.getCallbackScript()) {
      let callbackScript = toASM(Buffer.from(wp.getCallbackScript()), 0x01);
      let [_, blockHeight, originalMakerTxOutput] = await this._persistence.getInitialMakerOrder(outputScript, wp.getBlockHeight());
      order.setTradeHeight(blockHeight);
      ratio = new BN(originalMakerTxOutput.getValue()).div(new BN(o.getValue()));
    } else {
      order.setTradeHeight(wp.getBlockHeight());
    }

    order.setSendsUnit(new BN(makerInfo.sendsUnit).div(ratio).toString());
    order.setReceivesUnit(new BN(makerInfo.receivesUnit).div(ratio).toString());

    order.setCollateralizedNrg(internalToHuman(o.getValue(), NRG).toString());

    order.setTxHash(o.getHash());
    order.setTxOutputIndex(o.getIndex());
    order.setIsSettled(false);

    return order;
  }
}
exports.Wallet = Wallet;