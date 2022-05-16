'use strict';

const Client = require('bittorrent-tracker');
const swarm = require('discovery-swarm');
const { networks } = require('../config/networks');
const seederBootstrap = require('../utils/templates/collocation.json');
const dhtBootstrap = require('../utils/templates/bootstrap');
const logging = require('../logger');
const BC_MINER_POOL = process.env.BC_MINER_POOL && process.env.BC_MINER_POOL.indexOf('.') > -1 ? process.env.BC_MINER_POOL : false;
const BC_NETWORK = process.env.BC_NETWORK || 'main';
const BC_BUILD_GENESIS = process.env.BC_BUILD_GENESIS === 'true';

function getRandomSubarray(arr, size) {
  var shuffled = arr.slice(0),
      i = arr.length,
      min = i - size,
      temp,
      index;
  while (i-- > min) {
    index = Math.floor((i + 1) * Math.random());
    temp = shuffled[index];
    shuffled[index] = shuffled[i];
    shuffled[i] = temp;
  }
  return shuffled.slice(min);
}

function random(range) {
  return Math.floor(Math.random() * range);
}

//let seeds = BC_BUILD_GENESIS ? seederBootstrap : getRandomSubarray(seederBootstrap, 6)
let seeds = seederBootstrap;

function Discovery(nodeId) {
  // bootstrap from two randomly selected nodes
  if (process.env.BC_SEED_FILE !== undefined) {
    seeds = require(process.env.BC_SEED_FILE);
  }

  if (process.env.BC_SEED !== undefined) {
    let seed = process.env.BC_SEED;
    if (seed.indexOf(',') > -1) {
      seed = seed.split(',');
      seeds = seeds.concat(seed);
    } else {
      seeds.unshift(seed);
    }
  }

  const { infoHash, portBase, maximumWaypoints } = networks[BC_NETWORK];
  const maxConnections = process.env.BC_MAX_CONNECTIONS || maximumWaypoints;
  const seederPort = process.env.BC_SEEDER_PORT || portBase;
  const port = process.env.BC_DISCOVERY_PORT || portBase + 1;
  this.options = {
    maxConnections: maxConnections,
    keepExistingConnections: true,
    port: port,
    //utp: true,
    tcp: true,
    dns: process.env.BC_DISCOVERY_MDNS === 'true',
    dht: {
      concurrency: 128,
      //timeBucketOutdated: 1000000 + random(200000),
      bootstrap: dhtBootstrap,
      //interval: 8690000 + random(200000),
      maxConnections: maxConnections
    }
  };
  this.streamOptions = {
    infoHash: infoHash,
    peerId: nodeId,
    port: seederPort,
    announce: seeds,
    quiet: false,
    log: false
  };
  this.port = port;
  this.seederPort = seederPort;
  this.nodeId = nodeId;
  this._logger = logging.getLogger(__filename);
  this._logger.info('assigned edge resolution key <- ' + infoHash);
  this.hash = infoHash;
}

Discovery.prototype = {
  seeder: function () {
    const self = this;
    const client = new Client(self.streamOptions);
    const refreshWindow = 1000000 + random(280000);

    client.on('error', err => {
      // LDL
      self._logger.debug(err.message);
    });

    client.on('warning', function (err) {
      // LDL
      self._logger.debug(err.message);
    });

    setInterval(() => {
      try {
        client.update();
      } catch (err) {
        // LDL
        this._logger.debug(err.message);
      }
    }, refreshWindow);

    return client;
  },

  peerify: function (peer, channel) {
    if (typeof peer === 'number') peer = { port: peer };
    if (!peer.host) peer.host = '127.0.0.1';
    peer.id = peer.host + ':' + peer.port + '@' + (channel ? channel.toString('hex') : '');
    peer.retries = 0;
    peer.channel = channel;
    return peer;
  },

  start: function () {
    this._logger.info(`starting far reaching discovery module @ ${this.hash}:${this.port}`);
    this.dht = swarm(this.options);
    this.dht.hash = this.hash;
    this.dht.port = this.port;
    this.dht.listen(this.port);

    this.dht.on('peer-banned', (peer, info) => {
      // permit ban but override library bug and remove from the peersSeen table to permit resync requests
      delete this.dht._peersSeen[peer.id];
    });

    this.dht.on('connection-closed', (conn, info) => {
      //console.log('---- CONNECTION-CLOSED')
      //console.log(info)
      //let id = conn.id ? conn.id : info.id
      //if (this.dht._peersSeen[id]) {
      //  delete this.dht._peersSeen[id]
      //}
    });

    //this.dht.on('redundant-connection', (conn, info) => {
    //  console.log('REDUNDANT-CONNECTION')
    //  //console.log(info)
    //  //let id = conn.id ? conn.id : info.id
    //  //if (this.dht._peersSeen[id]) {
    //  //  delete this.dht._peersSeen[id]
    //  //}
    //})

    //this.dht.on('connecting', (peer, info) => {
    //  console.log('---- PEER CONNECTING')
    //  console.log(peer)
    //})

    this.dht.on('handshake-timeout', (conn, info) => {
      //let id = conn.id ? conn.id : info.id
      //if (this.dht._peersSeen[id]) {
      //  delete this.dht._peersSeen[id]
      //}
    });

    //this.dht.on('handshaking', (conn, info) => {
    //  console.log('HANDSHAKING')
    //  //console.log(info)
    //})

    //this.dht.on('peer-rejected', (peerAddress, info) => {
    //  console.log('PEER-REJECTED')
    //  //console.log(peerAddress)
    //  console.log(info)
    //})

    //this.dht.on('peer', (peer) => {
    //  console.log('PEER')
    //  //console.log(peer)
    //})

    this.dht.on('drop', peer => {
      //console.log('DROP')
      //console.log(peer)
      //let id = peer.id ? peer.id : false
      //if (id && this.dht._peersSeen[id]) {
      //  delete this.dht._peersSeen[id]
      //}
    });

    this.dht.qbroadcast = async (msg, filters) => {
      const warnings = [];
      if (filters === undefined) {
        filters = [];
      }
      for (const conn of this.dht.connections) {
        const idr = conn.remoteHost || conn.host;
        this._logger.info('announce <- ' + idr);
        if (filters.indexOf(idr) < 0) {
          const res = await this.dht.qsend(conn, msg);
          if (!res || res.success === false) {
            warnings.push(res);
          }
        }
      }
      return warnings;
    };
    return this.dht;
  },

  stop: function () {
    this.dht.leave(this.hash);
  }
};

module.exports = Discovery;