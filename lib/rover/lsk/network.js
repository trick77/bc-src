'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

exports.createNetwork = createNetwork;

const { Resolver } = require('dns').promises; /**
                                               * Copyright (c) 2017-present, Overline developers, All rights reserved.
                                               *
                                               * This source code is licensed under the MIT license found in the
                                               * LICENSE file in the root directory of this source tree.
                                               *
                                               * 
                                               */

// see https://lisk.com/documentation/lisk-sdk/references/lisk-elements/p2p.html for configuration options of P2P

const { randomBytes } = require('crypto');

const {
  P2P,
  events: {
    EVENT_CONNECT_OUTBOUND,
    EVENT_DISCOVERED_PEER,
    EVENT_FAILED_TO_ADD_INBOUND_PEER,
    EVENT_INBOUND_SOCKET_ERROR,
    EVENT_MESSAGE_RECEIVED,
    EVENT_NETWORK_READY,
    EVENT_NEW_INBOUND_PEER,
    EVENT_OUTBOUND_SOCKET_ERROR,
    EVENT_REQUEST_RECEIVED
  }
} = require('@liskhq/lisk-p2p');
const { Chain, blockSchema, blockHeaderSchema, transactionSchema } = require('@liskhq/lisk-chain');
const apiClient = require('@liskhq/lisk-api-client');
const { codec } = require('@liskhq/lisk-codec');
const { hash } = require('@liskhq/lisk-cryptography');
const { validator } = require('@liskhq/lisk-validator');
const { TokenTransferAsset, TokenModule } = require('lisk-framework');
const LRUCache = require('lru-cache');
const Emittery = require('emittery');
const { merge } = require('ramda');
const logging = require('../../logger');
const debugFactory = require('debug');
const debug = debugFactory('bcnode:rover:lsk:network');

const tokenTransferAsset = new TokenTransferAsset(BigInt(500000));
const tokenModule = new TokenModule({ minRemainingBalance: '10' });

const tokenModuleId = tokenModule.id;
const tokenTransferAssetId = tokenTransferAsset.id;
const tokenTransferAssetSchema = tokenTransferAsset.schema;

//app = await createApplication('actions-blocks');

const networks = {
  mainnet: '4c09e6a781fc4c7bdb936ee815de8f94190f8a7519becd9de2081832be309a99', // TODO take from lisk config
  testnet: '15f0dacc1060e91818224a94286b13aa04279c640bd5d6f193182031d133df7c'
};

const defaultAccountSchema = {
  token: {
    type: 'object',
    fieldNumber: 2,
    properties: {
      balance: {
        fieldNumber: 1,
        dataType: 'uint64'
      }
    },
    default: {
      balance: BigInt(0)
    }
  },
  sequence: {
    type: 'object',
    fieldNumber: 3,
    properties: {
      nonce: {
        fieldNumber: 1,
        dataType: 'uint64'
      }
    },
    default: {
      nonce: BigInt(0)
    }
  },
  keys: {
    type: 'object',
    fieldNumber: 4,
    properties: {
      numberOfSignatures: { dataType: 'uint32', fieldNumber: 1 },
      mandatoryKeys: {
        type: 'array',
        items: { dataType: 'bytes' },
        fieldNumber: 2
      },
      optionalKeys: {
        type: 'array',
        items: { dataType: 'bytes' },
        fieldNumber: 3
      }
    },
    default: {
      numberOfSignatures: 0,
      mandatoryKeys: [],
      optionalKeys: []
    }
  },
  dpos: {
    type: 'object',
    fieldNumber: 5,
    properties: {
      delegate: {
        type: 'object',
        fieldNumber: 1,
        properties: {
          username: { dataType: 'string', fieldNumber: 1 },
          pomHeights: {
            type: 'array',
            items: { dataType: 'uint32' },
            fieldNumber: 2
          },
          consecutiveMissedBlocks: { dataType: 'uint32', fieldNumber: 3 },
          lastForgedHeight: { dataType: 'uint32', fieldNumber: 4 },
          isBanned: { dataType: 'boolean', fieldNumber: 5 },
          totalVotesReceived: { dataType: 'uint64', fieldNumber: 6 }
        },
        required: ['username', 'pomHeights', 'consecutiveMissedBlocks', 'lastForgedHeight', 'isBanned', 'totalVotesReceived']
      },
      sentVotes: {
        type: 'array',
        fieldNumber: 2,
        items: {
          type: 'object',
          properties: {
            delegateAddress: {
              dataType: 'bytes',
              fieldNumber: 1
            },
            amount: {
              dataType: 'uint64',
              fieldNumber: 2
            }
          },
          required: ['delegateAddress', 'amount']
        }
      },
      unlocking: {
        type: 'array',
        fieldNumber: 3,
        items: {
          type: 'object',
          properties: {
            delegateAddress: {
              dataType: 'bytes',
              fieldNumber: 1
            },
            amount: {
              dataType: 'uint64',
              fieldNumber: 2
            },
            unvoteHeight: {
              dataType: 'uint32',
              fieldNumber: 3
            }
          },
          required: ['delegateAddress', 'amount', 'unvoteHeight']
        }
      }
    },
    default: {
      delegate: {
        username: '',
        pomHeights: [],
        consecutiveMissedBlocks: 0,
        lastForgedHeight: 0,
        isBanned: false,
        totalVotesReceived: BigInt(0)
      },
      sentVotes: [],
      unlocking: []
    }
  }
};

const chain = new Chain({
  accountSchemas: defaultAccountSchema,
  genesisBlock: {
    header: {
      timestamp: 0
    }
  }
});

// not needed
const customNodeInfoSchema = {
  $id: '/nodeInfo/custom',
  type: 'object',
  properties: {
    height: {
      dataType: 'uint32',
      fieldNumber: 1
    },
    maxHeightPrevoted: {
      dataType: 'uint32',
      fieldNumber: 2
    },
    blockVersion: {
      dataType: 'uint32',
      fieldNumber: 3
    },
    lastBlockID: {
      dataType: 'bytes',
      fieldNumber: 4
    }
  }

  // FIXME these two are define in lisk-framework module, but not exported?
};const getBlocksFromIdRequestSchema = exports.getBlocksFromIdRequestSchema = {
  $id: 'lisk/getBlocksFromIdRequest',
  title: 'Get Blocks From Id Request',
  type: 'object',
  required: ['blockId'],
  properties: {
    blockId: {
      fieldNumber: 1,
      dataType: 'bytes'
    }
  }
};

const getBlocksFromIdResponseSchema = exports.getBlocksFromIdResponseSchema = {
  $id: 'lisk/getBlocksFromIdResponse',
  title: 'Get Blocks From Id Response',
  type: 'object',
  required: ['blocks'],
  properties: {
    blocks: {
      type: 'array',
      fieldNumber: 1,
      items: {
        dataType: 'bytes'
      }
    }
  }
};

const postBlockEventSchema = exports.postBlockEventSchema = {
  $id: 'lisk/postBlockEvent',
  title: 'Post Block Event',
  type: 'object',
  required: ['block'],
  properties: {
    block: {
      dataType: 'bytes',
      fieldNumber: 1
    }
  }
};
const moduleRootLogger = logging.getLogger(`rover.lsk.network.root`, false);

async function createNetwork(config) {
  const resolver = new Resolver({ timeout: 100 });
  let seedPeers = [{
    'hostname': 'mainnet-seed-01.lisk.io',
    'port': 8001
  }, {
    'hostname': 'mainnet-seed-02.lisk.io',
    'port': 8001
  }, {
    'hostname': 'mainnet-seed-03.lisk.io',
    'port': 8001
  }, {
    'hostname': 'mainnet-seed-04.lisk.io',
    'port': 8001
  }, {
    'hostname': 'mainnet-seed-05.lisk.io',
    'port': 8001
  }, {
    'hostname': 'mainnet-seed-06.lisk.io',
    'port': 8001
  }, {
    'hostname': 'mainnet-seed-07.lisk.io',
    'port': 8001
  }, {
    'hostname': 'mainnet-seed-08.lisk.io',
    'port': 8001
  }, {
    'hostname': 'mainnet-seed-09.lisk.io',
    'port': 8001
  }, {
    'hostname': 'mainnet-seed-02.lisk-nodes.net',
    'port': 8001
  }, {
    'hostname': 'mainnet-seed-04.lisk-nodes.net',
    'port': 8001
  }, {
    'hostname': 'mainnet-seed-06.lisk-nodes.net',
    'port': 8001
  }, {
    'hostname': 'node03.lisk.io',
    'port': 8001
  }, {
    'hostname': 'node04.lisk.io',
    'port': 8001
  }, {
    'hostname': 'node05.lisk.io',
    'port': 8001
  }, {
    'hostname': 'node06.lisk.io',
    'port': 8001
  }, {
    'hostname': 'mainnet-seed-08.lisk-nodes.net',
    'port': 8001
  }, {
    'hostname': 'mainnet-seed-10.lisk-nodes.net',
    'port': 8001
  }];

  seedPeers = await Promise.allSettled(seedPeers.map(async ({ hostname, port }) => {
    let [ipAddress] = await resolver.resolve4(hostname);
    return { ipAddress, port };
  }));
  seedPeers = seedPeers.filter(result => result.status === 'fulfilled').map(result => result.value);

  moduleRootLogger.info('launching client');
  const client = await apiClient.createWSClient('wss://api.lisknode.io/ws');
  moduleRootLogger.info('client launched');
  const n = new Network(client, merge(config, { seedPeers }));
  return n;
}

function decodeBlockHeader(logger, blockHeader) {
  logger.debug(`attempting to process header`);
  const header = codec.decode(blockHeaderSchema, blockHeader);
  const blockID = hash(blockHeader);
  header.blockID = blockID;
  logger.debug('decodeBlockHeader() blockId = %s, header = %o', blockID.toString('hex'), header);

  return header;
}

function decodeBlock(cache, logger, blockData) {
  const block = codec.decode(blockSchema, blockData);
  logger.debug('decodeBlock() block = %o', block);
  const header = decodeBlockHeader(logger, block.header);

  if (cache === false || !cache.has(header.blockID.toString('hex'))) {
    let transactions = [];
    if (block.payload.length > 0) {
      for (let tx of block.payload) {
        const id = hash(tx);
        const txInput = codec.decode(transactionSchema, tx);
        logger.debug('decodeBlock() decoded tx = %O', txInput);

        if (txInput.moduleID === tokenModuleId && txInput.assetID === tokenTransferAssetId) {
          const asset = codec.decode(tokenTransferAssetSchema, txInput.asset);
          logger.debug('decodeBlock() decoded tx asset = %O', asset);
          const decodedTx = _extends({}, txInput, {
            id,
            asset
          });
          transactions.push(decodedTx);
        }
      }
    }
    return { header, transactions };
  }

  return false;
}

class Network extends Emittery {

  // WARNING: do not use directly, before setting up the P2P DNS resolve has to happen (for seed peers) and
  // that is not possible to do synchronously in nodejs
  // eslint-disable-line no-undef
  constructor(client, { networkName = 'mainnet', seedPeers = [] } = {}) {
    super();
    this._logger = logging.getLogger(__filename);
    const networkIdentifier = networks[networkName] ? networks[networkName] : networks.devnet;
    debug(`Running "${networks[networkName] ? networkName : 'devnet'}" network based on your input "${networkName}".`);

    this._latestBlockCache = new LRUCache(500);
    const nodeInfo = {
      advertiseAddress: false,
      networkIdentifier,
      networkVersion: '3.0',
      nonce: randomBytes(8).toString('hex'),
      // options: {},
      options: {
        lastBlockID: Buffer.alloc(0),
        blockVersion: 0,
        height: 0,
        maxHeightPrevoted: 0
      }

      // FIXME make port configurable
      // TODO is customNodeInfoSchema needed?
    };const config = {
      port: 8001,
      hostIp: '0.0.0.0',
      customNodeInfoSchema,
      seedPeers,
      nodeInfo
    };

    this._client = client;
    this._p2p = new P2P(config);
    this._logger.info('Created instance of P2P');
    this._configureP2P();
  } // eslint-disable-line no-undef


  _configureP2P() {
    // Start the P2P instance
    // Listen to request events
    this._p2p.on(EVENT_REQUEST_RECEIVED, request => {
      this._logger.debug('event = %s, %O', EVENT_REQUEST_RECEIVED, request);
    });
    // Listen to message events
    this._p2p.on(EVENT_MESSAGE_RECEIVED, async message => {
      message.event === 'postNodeInfo' ? this._logger.debug('event = %s', EVENT_MESSAGE_RECEIVED) : this._logger.debug('event = %s, %O', EVENT_MESSAGE_RECEIVED, message);

      if (message.event === 'postBlock') {
        try {
          const event = codec.decode(postBlockEventSchema, message.data);
          this._logger.debug('postblock event = %O, block buffer size = %d', event, event.block.length);
          const block = decodeBlock(this._latestBlockCache, this._logger, event.block);
          if (block !== false) {
            this.emit('newLatestBlock', block);
            this._latestBlockCache.set(block.header.blockID.toString('hex'), true);
          }
        } catch (e) {
          this._logger.error('error while decoding postBlock payload, e = %O', e);
        }
      }

      if (message.event === 'postTransactionsAnnouncement') {
        this._logger.debug('postTransactionsAnnouncement');
      }
    });
    // Listen to connect outgoing connections events
    this._p2p.on(EVENT_CONNECT_OUTBOUND, async outboundPeer => {
      this._logger.debug('event = %s, %O', EVENT_CONNECT_OUTBOUND, outboundPeer.peerId);
      this._logger.debug('Total number of connected peers = %d', this._p2p.getConnectedPeers().length);
    });
    // Listen to connect incoming connections error events
    this._p2p.on(EVENT_INBOUND_SOCKET_ERROR, inboundError => {
      this._logger.debug('event = %s, %O', EVENT_INBOUND_SOCKET_ERROR, inboundError);
    });
    // Listen to connect outgoing connections error events
    this._p2p.on(EVENT_OUTBOUND_SOCKET_ERROR, outboundError => {
      this._logger.debug('event = %s, %O', EVENT_OUTBOUND_SOCKET_ERROR, outboundError);
    });
    // Listen to connect incoming connections events
    this._p2p.on(EVENT_NEW_INBOUND_PEER, inboundPeer => {
      this._logger.debug('event = %s, %O', EVENT_NEW_INBOUND_PEER, inboundPeer);
    });
    // Listen to connect outgoing connections failure events due to duplicate connections, handshake, etc.
    this._p2p.on(EVENT_FAILED_TO_ADD_INBOUND_PEER, inboundFailedError => {
      this._logger.debug('event = %s, %O', EVENT_FAILED_TO_ADD_INBOUND_PEER, inboundFailedError);
    });
    this._p2p.on(EVENT_NETWORK_READY, () => {
      this._logger.debug('event = %s', EVENT_NETWORK_READY);
    });
    this._p2p.on(EVENT_DISCOVERED_PEER, peerInfo => {
      this._logger.debug('event = %s, peer = %O', EVENT_DISCOVERED_PEER, peerInfo);
    });

    this._p2p.on('error', error => {
      this._logger.debug(error);
    });
    this._logger.info('P2P configured');
  }

  async start() {
    await this._p2p.start();
    this._logger.debug('P2P node is running successfully');
  }

  async stop() {
    await this._p2p.stop();
    this._logger.debug('P2P node stopped');
  }

  async getBlocksByHeightBetween(from, to) {
    if (!this._client) {
      this._logger.info(`no client found to request range ${from} -> ${to}`);
      return;
    }

    const blocksByHeight = await this._client.invoke('app:getBlocksByHeightBetween', { from, to });
    debug('direct request %d -> %d', from, to);
    // disconnect socket
    debug('blocksByHeight %O', blocksByHeight);
    const decodedBlockHeaders = [];
    const decodedBlocks = [];
    for (const rawBlock of blocksByHeight) {
      debug('getBlocksByHeightBetween() block buffer size = %d', rawBlock.length);
      const b = chain.dataAccess.decode(Buffer.from(rawBlock, 'hex'));
      b.header.blockID = b.header.id;
      b.transactions = [];
      decodedBlocks.push(b);
    }

    decodedBlocks.reverse();

    const blockId = decodedBlocks[0].header.id.toString('hex');
    debug('got %d received blocks from heights', decodedBlocks.length);
    debug(`got received blocks from id ${blockId}`);
    return Promise.resolve({ blockId, blocks: decodedBlocks, isRequestByHeight: true });
  }

  async getBlocksSinceHash(blockId) {
    const data = codec.encode(getBlocksFromIdRequestSchema, { blockId });
    const decodedData = codec.decode(getBlocksFromIdRequestSchema, data);
    const errors = validator.validate(getBlocksFromIdRequestSchema, decodedData);

    if (errors.length) {
      this._logger.error('incorrect data for block request, errors = %O', errors);
      return;
    }
    const { data: blocks } = await this._p2p.request({ procedure: 'getBlocksFromId', data });

    const decodedResponse = codec.decode(getBlocksFromIdResponseSchema, blocks);
    this._logger.debug('got raw requested blocks = %O', decodedResponse);
    const decodedBlocks = [];
    for (const rawBlock of decodedResponse.blocks) {
      this._logger.debug('getBlocksSinceHash() block buffer size = %d', rawBlock.length);
      decodedBlocks.push(decodeBlock(false, this._logger, rawBlock));
    }

    this._logger.debug('got %d requested blocks', decodedBlocks.length);
    this.emit('blocksSinceHash', { blockId, blocks: decodedBlocks, isRequestByHeight: false });
  }
}