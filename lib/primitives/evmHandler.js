'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.EvmHandler = exports.setupVM = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; /**
                                                                                                                                                                                                                                                                   * Copyright (c) 2017-present, overline.network developers, All rights reserved.
                                                                                                                                                                                                                                                                   *
                                                                                                                                                                                                                                                                   * This source code is licensed under the MIT license found in the
                                                                                                                                                                                                                                                                   * LICENSE file in the root directory of this source tree.
                                                                                                                                                                                                                                                                   *
                                                                                                                                                                                                                                                                   * 
                                                                                                                                                                                                                                                                   */


exports.format = format;

var _vm = require('@ethereumjs/vm');

var _vm2 = _interopRequireDefault(_vm);

var _common = require('@ethereumjs/common');

var _common2 = _interopRequireDefault(_common);

var _tx = require('@ethereumjs/tx');

var _blockchain = require('@ethereumjs/blockchain');

var _blockchain2 = _interopRequireDefault(_blockchain);

var _block = require('@ethereumjs/block');

var _logger = require('../logger');

var _bc_pb = require('@overline/proto/proto/bc_pb');

var _index = require('../script/index');

var _index2 = _interopRequireDefault(_index);

var _txUtils = require('../core/txUtils');

var _evmData = require('../config/evmData');

var _bytecode = require('bcjs/dist/script/bytecode');

var _decimal = require('decimal.js');

var _wallet = require('../bc/wallet');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// https://github.com/ethereumjs/ethereumjs-monorepo/blob/053a3a178d76d1123e5bd2994115fc8cea26e977/packages/vm/tests/api/buildBlock.spec.ts#L29
// https://github.com/ethereumjs/ethereumjs-monorepo/blob/bffbc0385d0aef62097fd1bffeb9abdecdaa344d/packages/vm/tests/api/runTx.spec.ts
// https://github.com/dethcrypto/ethereumjs-vm/blob/master/examples/run-blockchain/index.ts
// https://github.com/ethereumjs/ethereumjs-monorepo/blob/053a3a178d76d1123e5bd2994115fc8cea26e977/packages/vm/tests/api/buildBlock.spec.ts#L94
// https://github.com/ethereumjs/ethereumjs-monorepo/blob/b66c38226ce078e3ccbce9cda1000cd9cf56b2bd/packages/vm/tests/api/customChain.spec.ts
// test utils https://github.com/ethereumjs/ethereumjs-monorepo/blob/aec64d05230cc0dd7050d7bf072dca6178dc7b62/packages/vm/tests/util.ts
// block library: https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/block

// parent:  0x6bfee7294bf44572b7266358e627f3c35105e1c3851f3de09e6d646f955725a7
// block:     b23b5de14d6439a776aefea0d0d763978f14b38da8f29b9f3c749646de003a7c

const { calcTxFee } = require('bcjs/dist/transaction');
const {
  Account,
  Address,
  toBuffer,
  BN,
  rlp,
  keccak256,
  stripHexPrefix,
  setLengthLeft
} = require('ethereumjs-util');
const LRUCache = require('lru-cache');
const { inspect } = require('util');
const { getScriptType, ScriptType } = require('bcjs/dist/script/templates');

const {
  internalToHuman,
  CurrencyConverter,
  CurrencyInfo,
  COIN_FRACS: { NRG }
} = require('../core/coin');
const debugFactory = require('debug');
const debug = debugFactory('bcnode:primitives:evmHandler');

function format(a, toZero = false, isHex = false) {
  if (a === '') {
    return Buffer.alloc(0);
  }

  if (a.slice && a.slice(0, 2) === '0x') {
    a = a.slice(2);
    if (a.length % 2) a = '0' + a;
    a = Buffer.from(a, 'hex');
  } else if (!isHex) {
    a = Buffer.from(new BN(a).toArray());
  } else {
    if (a.length % 2) a = '0' + a;
    a = Buffer.from(a, 'hex');
  }

  if (toZero && a.toString('hex') === '') {
    a = Buffer.from([0]);
  }

  return a;
}

const setupVM = exports.setupVM = (db, opts = {}) => {
  const { common, genesisBlock } = opts;
  if (!opts.blockchain) {
    opts.blockchain = new _blockchain2.default({
      db,
      validateBlocks: false,
      validateConsensus: false,
      common,
      genesisBlock
    });
  }
  return new _vm2.default(_extends({}, opts));
};

const createBlock = (parent, n = 0, opts = {}) => {
  if (!parent) {
    return _block.Block.genesis(undefined, opts);
  }

  const blockData = {
    header: {
      number: n,
      parentHash: parent.hash ? parent.hash() : parent, // optional
      difficulty: new BN(0xfffffff), // optional
      stateRoot: parent.header ? parent.header.stateRoot : null // optional
    }
  };
  return _block.Block.fromBlockData(blockData, opts);
};

class EvmHandler {

  constructor(persistence, txPendingPool, utxoManager, wallet, pubsub) {
    this._logger = (0, _logger.getLogger)(__filename);
    this._persistence = persistence;
    this._txPendingPool = txPendingPool;
    this._utxoManager = utxoManager;
    this._wallet = wallet;
    this._pubsub = pubsub;
    this._interpreter = new _index2.default(this._persistence, this._utxoManager);

    // setup the VM

    this._knownScriptsCache = new LRUCache({
      max: 10000
    });
  }

  // Used only once to setup the initial VM
  async _setupBlockchain(state, data) {

    const blockchain = this.blockchain;

    await state.checkpoint();
    for (const address of Object.keys(data.pre)) {
      const { nonce, balance, code, storage } = data.pre[address];

      const addressBuf = format(address);
      const codeBuf = format(code);
      const codeHash = keccak256(codeBuf);

      const storageTrie = state.copy(false);
      storageTrie.root = null;

      // Set contract storage
      for (const storageKey of Object.keys(storage)) {
        const valBN = new BN(format(storage[storageKey]), 16);
        if (valBN.isZero()) {
          continue;
        }
        const val = rlp.encode(valBN.toArrayLike(Buffer, 'be'));
        const key = setLengthLeft(format(storageKey), 32);

        await storageTrie.put(key, val);
      }

      const stateRoot = storageTrie.root;

      if (data.exec && data.exec.address === address) {
        data.root = storageTrie.root;
      }

      // Put contract code
      await state.db.put(codeHash, codeBuf);

      // Put account data
      const account = Account.fromAccountData({ nonce, balance, codeHash, stateRoot });
      await state.put(addressBuf, account.serialize());
    }
    await state.commit();
  }

  async init() {

    //const common = new Common({ chain: Chain.Ropsten, hardfork: Hardfork.Byzantium  })
    //common.setMaxListeners(100)
    //const rlp = "0xf901fcf901f7a00000000000000000000000000000000000000000000000000000000000000000a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347948888f1f195afa192cfee860698584c030f4c9db1a07d883d38bc7a640dd66e5cda78cd01b52a7dc40e61f7c2ddbab7cb3ae3b8b9f2a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b90100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008302000080832fefd8808454c98c8142a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421880102030405060708c0c0"
    //const genesisRlp = Buffer.from(evmData.genesisRLP.slice(2), 'hex')
    //const g = Block.fromRLPSerializedBlock(genesisRlp, { common })
    //const genesisBlock = createBlock(g, 0, { common })
    //const blockchain = await Blockchain.create({
    //  db: this.persistence,
    //  genesisBlock,
    //  validateBlocks: false,
    //  common,
    //  validateConsensus: false
    //})

    //this.blockchain = blockchain

    //const vm = await VM.create({
    //  db: this.persistence,
    //  blockchain,
    //  common,
    //  activateGenesisState: true
    //})

    //await this._setupBlockchain(vm.stateManager._trie, evmData)
    //const accountPk = Buffer.from('22321a360425879d3e5ba2362322c1551972c250f91a77fd73c34a7e2d2065dd', 'hex')
    //const accountAddress = Address.fromPrivateKey(accountPk)
    //const acc  = await vm.stateManager.getAccount(accountAddress)

    // ~~~~~~ TODO: PREPARE STATE TRANSFER IN SCRIPT

    //const b1 = createBlock(genesisBlock, 1,  {common})
    //const b2 = createBlock(b1, 2,  {common})
    //const b3 = createBlock(b2, 3,  {common})

    //await this._vm._blockchain.putBlock(b1)
    //await this._vm._blockchain.putBlock(b2)
    //await this._vm._blockchain.putBlock(b3)

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //const blockBuilder = await vm.buildBlock({ parentBlock, blockData, blockOpts })
    //const txResult = await blockBuilder.addTransaction(tx)
    //// reset the state with `blockBuilder.revert()`
    //const block = await blockBuilder.build()
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //const serialized = Buffer.from('f901f7a06bfee7294bf4457...', 'hex')
    //const block = Block.fromRLPSerializedBlock(serialized, { hardforkByBlockNumber })
    //const result = await vm.runBlock(block)

    //let head = await this._blockchain.getHead()
    //await this._vm.runBlockchain()
    //const accountPk = Buffer.from('f308fc02ce9172ad02a7d75800ecfc027109bc67987ea32aba9b8dcc7b10150e', 'hex')
    //const accountAddress = Address.fromPrivateKey(accountPk)
    //const account = Account.fromAccountData({
    //  nonce: 0,
    //  balance: new BN(10).pow(new BN(18))
    //})

    ////await this._vm.stateManager.checkpoint()
    ////await this._vm.stateManager.putAccount(accountAddress, account)
    ////await this._vm.stateManager.commit()
    ////await this._vm.stateManager._cache.flush()
    ////this._vm.stateManager._cache.clear()
    //const acc  = await this._vm.stateManager.getAccount(accountAddress)
    //console.log(acc.balance.toString())
    //const transferCost = 21000
    //const unsignedTx = TransactionFactory.fromTxData(
    //  {
    //                to: accountAddress,
    //                gasLimit: transferCost,
    //                gasPrice: 100,
    //                nonce: 0,
    //                type: 0,
    //                maxPriorityFeePerGas: 50,
    //                maxFeePerGas: 50,
    //              },
    //            { common }
    //          )
    //const tx = unsignedTx.sign(accountPk)
    //const coinbase = Buffer.from('00000000000000000000000000000000000000ff', 'hex')
    //const block = Block.fromBlockData(
    //  {
    //                header: {
    //                                gasLimit: transferCost - 1,
    //                                coinbase
    //                                //baseFeePerGas: 7,
    //                              },
    //              },
    //            { common }
    //          )
    //const result = await this._vm.runTx({
    //            tx,
    //            block,
    //            skipBlockGasLimitValidation: true,
    //          })
    //console.log(result)
    //const coinbaseAccount = await this._vm.stateManager.getAccount(new Address(coinbase))
    //console.log(coinbaseAccount)

  }

  async processTx(tx) {

    // //commenting out this function for now
    // //extract address
    const hash = tx.getHash();
    const inputs = tx.getInputsList();
    const outputs = tx.getOutputsList();
    this._logger.info(`script from address: ${hash}, inputs: ${inputs.length}, outputs: ${outputs.length}`);

    this._pubsub.publish('tx.evm', {
      type: 'tx.evm',
      data: hash
    });
  }

  async isEvmTx(tx) {

    try {
      const id = tx.getHash();
      if (this._knownScriptsCache.has(id)) {
        debug(`evm script already known ${id}`);
        return;
      }
      const outputs = tx.getOutputsList();
      const outputScript = (0, _bytecode.toASM)(Buffer.from(outputs[0].getOutputScript()), 0x01);
      debug(`check feed script ${outputScript}`);
      if (outputScript.indexOf('OP_X 0x02') > -1) {
        this._knownScriptsCache.set(id, true);
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

}
exports.EvmHandler = EvmHandler;