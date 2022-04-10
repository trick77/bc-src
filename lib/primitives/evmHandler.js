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

const { calcTxFee } = require('bcjs/dist/transaction');
const { Account, Address, toBuffer, BN } = require('ethereumjs-util');
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

const setupVM = exports.setupVM = (db, opts = {}) => {
  const { common, genesisBlock } = opts;
  if (!opts.blockchain) {
    opts.blockchain = new _blockchain2.default({
      db,
      validateBlocks: true,
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
      parentHash: parent.hash(),
      difficulty: new BN(0xfffffff),
      stateRoot: parent.header.stateRoot
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
  async init() {

    //const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Chainstart })
    //common.setHardforkByBlockNumber(0)
    //common.setMaxListeners(100)
    //const rlp = "0xf901fcf901f7a00000000000000000000000000000000000000000000000000000000000000000a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347948888f1f195afa192cfee860698584c030f4c9db1a07d883d38bc7a640dd66e5cda78cd01b52a7dc40e61f7c2ddbab7cb3ae3b8b9f2a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b90100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008302000080832fefd8808454c98c8142a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421880102030405060708c0c0"
    //const genesisRlp = toBuffer(rlp)
    ////const genesisBlock = Block.genesis({ header: { gasLimit: 50000 } }, { common })
    ////const genesisBlock = Block.genesis(undefined, { common })
    //const genesisBlock = Block.fromRLPSerializedBlock(genesisRlp, { common })
    ////const blockchain = await Blockchain.create({ db: this._persistence, genesisBlock, common, validateConsensus: false, validateBlocks: false})
    //this._vm = await setupVM(this._persistence, { common, genesisBlock })
    //await this._vm.init()
    ////this._vm = await VM.create({ common, blockchain })
    //process.exit()

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

    this._pubsub.publish('tx.evm.update', {
      type: 'tx.evm.update',
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