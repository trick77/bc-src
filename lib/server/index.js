'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.jsonRpcMiddleware = jsonRpcMiddleware;
/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const debug = require('debug')('bcnode:server:main');
const path = require('path');
const http = require('http');
const bodyParser = require('body-parser');
const express = require('express');
const cors = require('cors');
const auth = require('basic-auth');
const expressWinston = require('express-winston');
const responseTime = require('response-time');
const expressStaticGzip = require('express-static-gzip');
const WebSocket = require('ws');
const CircularBuffer = require('circular-buffer');
const SocketIO = require('socket.io');
const ngrok = require('ngrok');
const open = require('open');
const fetch = require('node-fetch');

const { anyDns } = require('../engine/helper');
const logging = require('../logger');
const { config } = require('../config');
const { Null, Block, Transaction } = require('../protos/core_pb');
const {
  TransferRequest,
  GetUtxosRequest,
  GetOutPointRequest,
  GetBlockHeightRequest,
  GetBlockHashRequest,
  GetRoveredBlockHeightRequest,
  GetRoveredBlockHashRequest,
  GetBlocksRequest,
  GetRoveredBlocksRequest,
  GetHistoryRequest,
  GetTxRequest,
  GetMarkedTxRequest,
  GetUtxoLengthRequest,
  GetUnlockTakerTxParamsRequest,
  GetSpendableCollateralRequest,
  GetBalanceRequest,
  GetBlake2blRequest,
  VanityConvertRequest,
  RpcFeedTransaction,
  RpcUpdateFeedTransaction,
  RpcTransaction
} = require('../protos/bc_pb');
const { Engine } = require('../engine');
const { BC_SUPER_COLLIDER } = require('../bc/chainstate');
const { RpcClient, RpcServer } = require('../rpc');
const { dispatcher: socketDispatcher } = require('./socket');
const { parseBoolean } = require('../utils/config');

const assetsDir = path.resolve(__dirname, '..', '..', 'public');
const docsDir = path.resolve(__dirname, '..', '..', 'docs');
const logsDir = path.resolve(__dirname, '..', '..', '_logs');

const PORT = process.env.BC_UI_PORT && parseInt(process.env.BC_UI_PORT, 10) || config.server.port;
const START_TUNNEL = parseBoolean(process.env.BC_TUNNEL_HTTPS);
const OPEN_UI = parseBoolean(process.env.BC_OPEN_UI);

const BC_NETWORK = process.env.BC_NETWORK || 'main';

// See http://www.programwitherik.com/getting-started-with-socket-io-node-js-and-express/
class Server {

  constructor(engine, rpcServer) {
    // Create express app instance
    this._app = express();
    this._engine = engine;
    this._rpcClient = new RpcClient();
    this._rpcServer = rpcServer;
    this._server = null;
    this._logger = logging.getLogger(__filename);
    this._roveredBlocksBuffer = new CircularBuffer(24);

    // setInterval(() => {
    //   const peers = this._getPeers()
    //   this._logger.info('!!! PEERS', peers)
    // }, 3000)
  } // eslint-disable-line


  get app() {
    // eslint-disable-line
    return this._app;
  }

  get engine() {
    return this._engine;
  }

  get opts() {
    return this._opts;
  }

  get rpcClient() {
    return this._rpcClient;
  }

  get server() {
    return this._server;
  }

  get p2p() {
    return this.engine._node._discovery;
  }

  async run(opts) {
    this._opts = opts;

    anyDns().then(ip => {
      this._ip = ip;
    });

    this._logger.debug('Starting Server for Web UI');

    if (config.server.logCalls) {
      this.app.use(expressWinston.logger({ winstonInstance: this._logger }));
    }

    this.app.use(responseTime());
    this.app.use(bodyParser.json({ limit: '1mb' }));

    // TODO: Generate automagically
    const mapping = {
      getFastSyncStatus: Null,
      getLatestBlock: Null,
      getLatestUTXOBlock: Null,
      getLatestRoveredBlocks: Null,
      getBlocksHeight: GetBlockHeightRequest,
      getBlockHeight: GetBlockHeightRequest,
      getBlockHash: GetBlockHashRequest,
      getRoveredBlockHeight: GetRoveredBlockHeightRequest,
      getRoveredBlockHash: GetRoveredBlockHashRequest,
      getBlocks: GetBlocksRequest,
      getRoveredBlocks: GetRoveredBlocksRequest,
      getRawMempool: Null,
      getTx: GetTxRequest,
      getMarkedTx: GetMarkedTxRequest,
      getBlockByTx: GetTxRequest,
      getByteFeeMultiplier: Null,
      getRoveredBlockForMarkedTx: GetMarkedTxRequest,
      help: Null,
      stats: Null,
      getBalance: GetBalanceRequest,
      getEmbBalance: GetBalanceRequest,
      getWallet: GetBalanceRequest,
      getSpendableOutpoints: GetSpendableCollateralRequest,
      getSpendableCollateral: GetSpendableCollateralRequest,
      getUnlockTakerTxParams: GetUnlockTakerTxParamsRequest,
      getOpenOrders: GetSpendableCollateralRequest,
      getMatchedOrders: GetSpendableCollateralRequest,
      getHistoricalOrders: GetHistoryRequest,
      getUnmatchedOrders: GetBalanceRequest,
      getUtxos: GetUtxosRequest,
      getUTXOLength: GetUtxoLengthRequest,
      getSTXOLength: GetUtxoLengthRequest,
      getBlake2bl: GetBlake2blRequest,
      getBcAddressViaVanity: VanityConvertRequest,
      getOutpointStatus: GetOutPointRequest,
      getTradeStatus: GetOutPointRequest,
      getTxClaimedBy: GetOutPointRequest,
      getTransfers: TransferRequest,
      getNrgSupply: Null,
      newTx: RpcTransaction,
      newFeed: RpcFeedTransaction,
      updateFeed: RpcUpdateFeedTransaction,
      sendTx: Transaction,
      getCurrentWork: Null,
      getSettings: Null,
      getSyncStatus: Null,
      getMarkedTxsForMatchedOrder: GetOutPointRequest
      // console.log(this._engine.node.p2p)
      // this._logger.info('!!! SERVER START', this._engine._node)

    };this.app.get('/geo/ip2geo/:ip', (req, res, next) => {
      const ip = req.params.ip;
      const geores = this.engine.geoDb.get(ip);
      const city = geores && geores.city;
      const location = geores && geores.location;

      res.json({
        ip: ip,
        city,
        location
      });
    });

    // FIXME: move to rpc
    this.app.use('/rpc', cors({ origin: '*' }), (req, res, next) => {
      // no secure cookie defined, allow every request
      if (!this._opts.rpcSecureCookie) {
        next();
        return;
      }

      const credentials = auth(req);
      if (!credentials || credentials.pass !== this._opts.rpcSecureCookie) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="BC"');
        res.end('Access denied');
      } else {
        next();
      }
    }, jsonRpcMiddleware(mapping));

    // Create http server for UI
    // $FlowFixMe see https://github.com/facebook/flow/issues/5113
    const server = http.Server(this.app);
    this._server = server;

    if (this.opts.ws) {
      this.initWebSocket(server);
    }

    if (this.opts.rpc) {
      this.initRpc();
    }

    if (this.opts.ui) {
      this.initUi();
    }

    // Listen for connections
    server.listen(PORT, async () => {
      this._logger.info(`UI available at http://0.0.0.0:${PORT}`);
      if (START_TUNNEL) {
        await this._createNgrokTunnel();
        if (OPEN_UI) {
          open(this._ngrokTunnelAddress);
        }
      }
    });

    if (START_TUNNEL) {
      this._ngrokLivenessProbeInterval = setInterval(async () => {
        this._logger.debug('_ngrokLivenessProbeInterval() tick');
        const tunnelIsLive = await this._checkNgrokTunellLiveness();
        this._logger.debug(`_ngrokLivenessProbeInterval() tunnelIsLive: ${tunnelIsLive}`);
        if (!tunnelIsLive) {
          this._logger.info('HTTPS tunnel was stale - refreshing');
          await this._createNgrokTunnel();
        }
      }, 20 * 60 * 1000); // 20 min
    }

    return true;
  }

  async _createNgrokTunnel() {
    if (this._ngrokTunnelAddress) {
      await ngrok.disconnect();
      this._ngrokTunnelAddress = undefined;
    }
    try {
      this._ngrokTunnelAddress = await ngrok.connect(PORT);
    } catch (e) {
      this._logger.warn('Unable to open the HTTPS tunnel via ngrok');
    }

    if (this._ngrokTunnelAddress) {
      this._logger.info(`HTTPS tunnel available at ${this._ngrokTunnelAddress}`);
    }
  }

  async _checkNgrokTunellLiveness() {
    if (!this._ngrokTunnelAddress) {
      return false;
    }

    try {
      const response = await fetch(this._ngrokTunnelAddress);
      if (response.status !== 200) {
        return false;
      }
    } catch (e) {
      return false;
    }

    return true;
  }

  initWebSocket(server) {
    const serverSocket = SocketIO(server, {
      path: '/ws',
      transports: ['websocket', 'polling']
    });

    serverSocket.on('connection', socket => {
      const ip = socket.request.connection.remoteAddress;

      debug('socket client connected', socket.id, ip);

      socket.on('disconnect', () => {
        debug('socket client disconnected', socket.id, ip);
      });

      socket.on('message', msg => {
        debug('socket message received', msg);
      });

      socket.on('block.get', msg => {
        socketDispatcher(this, socket, { type: 'block.get', data: msg });
      });

      socket.on('blocks.get', msg => {
        socketDispatcher(this, socket, { type: 'blocks.get', data: msg });
      });

      socket.on('multiverse.get', msg => {
        socketDispatcher(this, socket, { type: 'multiverse.get', data: msg });
      });

      socket.on('multiverse.purge', msg => {
        socketDispatcher(this, socket, { type: 'multiverse.purge', data: msg });
      });

      socket.on('tx.get', msg => {
        socketDispatcher(this, socket, { type: 'tx.get', data: msg });
      });

      socket.on('search.get', msg => {
        socketDispatcher(this, socket, { type: 'search.get', data: msg });
      });

      // this._wsSendInitialState(socket)
    });

    // setup relaying events from rpc server to websockets
    this._rpcServer.emitter.on('collectBlock', ({ block }) => {
      this._roveredBlocksBuffer.enq(block);
      this._wsBroadcast({ type: 'rover.latest', data: this._transformBlockToWire(block) });
    });

    this.engine.pubsub.subscribe('block.mined', '<server>', block => {
      this._wsBroadcast(block);
    });

    this.engine.pubsub.subscribe('emblem.bonus', '<server>', data => {
      this._wsBroadcast({ type: 'emblem.bonus', data: data });
    });

    this.engine.pubsub.subscribe('block.peer', '<server>', block => {
      this._wsBroadcast({ type: 'block.new', data: block.data.toObject() });
    });

    this._socket = serverSocket;
  }

  initRpc() {
    this.app.post('/rpc', (req, res, next) => {
      const { method } = req.rpcBody;
      // Handle error state as described - http://www.jsonrpc.org/specification#error_object
      if (!this.rpcClient.bc[method]) {
        return res.json({
          code: -32601,
          message: 'Method not found'
        });
      }

      const { MsgType, params = [], id } = req.rpcBody;
      try {
        let msg = null;
        if (Array.isArray(params)) {
          // this means there is missing method key in the mapping object in the servers run method
          if (MsgType === undefined) {
            this._logger.warn('MsgType undefined for method = %s', method);
            return res.json({
              code: -32000,
              message: `MsgType not defined for method = "${method}"`
            });
          }
          msg = new MsgType(params);
        } else if (params.type === 'Buffer') {
          msg = MsgType['deserializeBinary'](params.data);
        } else {
          throw new Error('invalid params');
        }

        this.rpcClient.bc[method](msg, (err, response) => {
          if (err) {
            this._logger.debug(err);

            return res.json({
              error: err
            });
          }

          res.json({
            jsonrpc: '2.0',
            result: response.toObject(),
            id
          });
        });
      } catch (err) {
        console.trace(err);
        this._logger.warn(`Message for method "${method}" is not a valid RPC constructor`);
        return res.json({
          code: -32600,
          message: 'Invalid request'
        });
      }
    });
  }

  initUi() {
    // this.app.use('/doc', express.static(docsDir))
    // this.app.use('/logs',
    //   express.static(logsDir),
    //   serveIndex(logsDir, {
    //     icons: true,
    //     view: 'details'
    //   })
    // )

    // Serve static content
    this.app.use(expressStaticGzip(assetsDir)
    // serveIndex(assetsDir, {
    //   icons: true
    // })
    );

    const peerInterval = setInterval(() => {
      try {
        const peers = this._getPeers();
        this._wsBroadcast({
          type: 'map.peers',
          data: peers
        });
      } catch (err) {
        // LDL
        this._logger.debug('Unable to get and broadcast (WS) peers');
      }
    }, 10000);
  }

  _getPeers() {
    if (!this.p2p) {
      return { me: null, peers: {} };
    }

    const ip = this._ip || this.p2p.ip;
    if (!ip) {
      return { me: null, peers: {} };
    }

    const geo = this._engine.geoDb.get(ip);
    if (!geo) {
      return { me: null, peers: {} };
    }

    const me = {
      ip,
      city: geo.city,
      location: geo.location
    };

    const connections = this.p2p.connections || [];
    const peers = {};
    for (const peer of connections) {
      const ip = `${peer.remoteAddress}`;
      if (this._engine.geoDbValidate(ip)) {
        const geo = this._engine.geoDb.get(ip);
        if (geo && geo.location) {
          peers[ip] = {
            ip,
            city: geo.city,
            location: geo.location
          };
        }
      }
    }

    return {
      me,
      peers
    };
  }

  _transformBlockToWire(block) {
    if (block !== undefined && block.getTimestamp !== undefined) {
      return {
        timestamp: block.getTimestamp(),
        blockchain: block.getBlockchain ? block.getBlockchain() : BC_SUPER_COLLIDER,
        hash: block.getHash(),
        height: block.getHeight()
      };
    } else {
      return {};
    }
  }

  _transformPeerToWire(peer) {
    // return {
    //  id: ""peer.id.toB58String(),
    //  meta: peer.meta,
    //  addrs: peer.multiaddrs._multiaddrs.map((addr) => addr.toString()),
    //  addr: peer._connectedMultiaddr && peer._connectedMultiaddr.toString()
    // }
    return {
      id: '',
      meta: '',
      addrs: '',
      addr: ''
    };
  }

  _wsBroadcast(msg) {
    // if(msg.type == 'block.new') console.log({msg})
    if (this._socket) {
      this._socket.emit(msg.type, msg.data);
    }
  }

  _wsBroadcastMultiverse(multiverse) {
    const blocksToSend = multiverse._chain;

    this._wsBroadcast({
      type: 'multiverse.set',
      data: blocksToSend
    });
  }

  _wsBroadcastPeerCount(count) {
    this._wsBroadcast({
      type: 'peer.count',
      data: count
    });
  }

  _wsSendInitialState(socket) {
    let peers = [];

    // TODO prepare peer data using this._transformPeerToWire - get them from p2p/node
    const msgs = [{
      type: 'block.snapshot',
      data: this._roveredBlocksBuffer.toarray().map(this._transformBlockToWire)
    }, {
      type: 'peer.snapshot',
      data: peers
    }, {
      type: 'profile.set',
      data: {
        peer: this._transformPeerToWire({}),
        network: BC_NETWORK
      }
    }];

    try {
      msgs.push({
        type: 'map.peers',
        data: this._getPeers()
      });
    } catch (err) {
      this._logger.info('Unable to get and send initial peers', err);
    }

    msgs.map(msg => {
      socket.emit(msg.type, msg.data);
    });
  }
}

exports.Server = Server; /**
                          * Converts incoming json body to rpc body using mapping provided
                          *
                          *  Mapping
                          *
                          *  ```
                          *  {
                          *    subtract: Object
                          *  }
                          *  ```
                          *
                          * Incoming JSON body
                          *
                          * ```
                          * {
                          *   jsonrpc: '2.0',
                          *   method: 'subtract',
                          *   params: [ 42, 23 ],
                          *   id: 1
                          * }
                          * ```
                          *
                          * Fabricated (output) RPC message
                          *
                          * ```
                          * {
                          *   method: 'subtract',
                          *   params: [42, 23],
                          *   MsgType: Object
                          * }
                          * ```
                          *
                          * @param mappings
                          * @return {Function}
                          */
// TODO: Order named params to params array
// TODO: Handle RPC call batch

function jsonRpcMiddleware(mappings) {
  // TODO: Report why is the request invalid
  function validRequest(rpc) {
    debug('jsonRpcMiddleware() validRequest() req = %O', rpc);
    // $FlowFixMe
    return rpc.jsonrpc === '2.0' && (
    // $FlowFixMe
    typeof rpc.id === 'number' || typeof rpc.id === 'string') &&
    // $FlowFixMe
    typeof rpc.method === 'string';
  }

  return function (req, res, next) {
    if (!validRequest(req.body)) {
      res.json({
        code: -32600,
        message: 'Invalid Request'
      });

      return;
    }

    // $FlowFixMe
    const { method, params } = req.body;
    // $FlowFixMe
    req.rpcBody = {
      method,
      params, // Handle named params
      // $FlowFixMe
      MsgType: mappings[method],
      // $FlowFixMe
      id: req.body.id
    };
    next();
  };
}

exports.default = Server;