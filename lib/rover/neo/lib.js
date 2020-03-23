'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const profiles = require('@cityofzion/neo-js/dist/common/profiles');
const request = require('request');
const { concat, merge, pick, sort, uniq } = require('ramda');
const debug = require('debug')('bcnode:rover:neo:lib');

const getNodes = exports.getNodes = function (network = 'mainnet') {
  debug(`getNodes() start`);
  return new Promise(function (resolve, reject) {
    request({
      url: `http://monitor.cityofzion.io/assets/${network}.json`,
      headers: { 'Accept': 'application/json' }
    }, function (error, response, body) {

      try {

        let rawNodes = { sites: [] };
        if (!error && body && body.indexOf('<') < 0) {
          rawNodes = JSON.parse(body);
        }

        debug(`Got ${rawNodes.sites.length} nodes`);

        let neoscanNodes = rawNodes.sites.filter(n => n.type.toLowerCase() === 'rpc' && n.port).map(pick(['url', 'port', 'protocol'])).map(({ protocol, url, port }) => ({ domain: `${protocol}://${url}`, port: `${port}` }));

        const defaultNodes = [{ domain: 'https://seed1.neo.org', port: 10331 }, { domain: 'http://seed2.neo.org', port: 10332 }, { domain: 'http://seed3.neo.org', port: 10332 }, { domain: 'http://seed4.neo.org', port: 10332 }, { domain: 'http://seed5.neo.org', port: 10332 }, { domain: 'http://seed1.cityofzion.io', port: 8080 }, { domain: 'http://seed2.cityofzion.io', port: 8080 }, { domain: 'http://seed3.cityofzion.io', port: 8080 }, { domain: 'http://seed4.cityofzion.io', port: 8080 }, { domain: 'http://seed5.cityofzion.io', port: 8080 }, { domain: 'https://seed1.cityofzion.io', port: 443 }, { domain: 'https://seed2.cityofzion.io', port: 443 }, { domain: 'https://seed3.cityofzion.io', port: 443 }, { domain: 'https://seed4.cityofzion.io', port: 443 }, { domain: 'https://seed5.cityofzion.io', port: 443 }, { domain: 'https://seed0.cityofzion.io', port: 443 }, { domain: 'https://seed6.cityofzion.io', port: 443 }, { domain: 'https://seed7.cityofzion.io', port: 443 }, { domain: 'https://seed8.cityofzion.io', port: 443 }, { domain: 'https://seed9.cityofzion.io', port: 443 }].reduce((all, n) => {
          all.push(`${n.domain}:${n.port}`);
          return all;
        }, []);

        neoscanNodes = neoscanNodes.concat(defaultNodes);
        debug(`Neoscan nodes %o`, neoscanNodes);

        const configNodes = profiles.default.rpc[network];
        debug(`config nodes %o`, configNodes);

        const rpcNodes = uniq(concat(configNodes, neoscanNodes)).map(merge({ bestHeight: null, lastPing: null, correct: false }));

        return resolve(rpcNodes);
      } catch (e) {
        console.trace(e);
        return reject(e);
      }
    });
  });
};

const benchmarkNode = exports.benchmarkNode = async function (node) {
  if (node && node.endpoint) {
    const start = Date.now();
    try {
      const blockHeight = await getBlockCount(node);
      const roundtrip = Date.now() - start;
      debug(`benchmarkNode(${node.endpoint}) success`);
      return { success: true, blockHeight, roundtrip };
    } catch (e) {
      debug(`benchmarkNode(${node.endpoint}) failure ${e.message}`);
      return { success: false, blockHeight: null, roundtrip: null };
    }
  } else {
    return { success: false, blockHeight: null, roundtrip: null };
  }
};

const getBlockCount = exports.getBlockCount = async function ({ endpoint }) {
  const randId = Math.random() * 1e6 | 0;
  return new Promise(function (resolve, reject) {
    request({
      url: endpoint,
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      json: true,
      body: { jsonrpc: '2.0', id: randId, method: 'getblockcount', params: [] },
      timeout: 1500
    }, function (error, response, body) {
      if (error) {
        return reject(error);
      }

      if (response.statusCode < 200 || response.statusCode > 299) {
        return reject(new Error(`Status was ${response.statusCode}`));
      }

      if (body.jsonrpc !== '2.0' || body.id !== randId) {
        return reject(new Error(`JSON-RPC response invalid (jsonrpc ${body.jsonrpc}, id ${body.id}, generated id ${randId})`));
      }

      return resolve(parseInt(body.result, 10));
    });
  });
};

const getBlock = exports.getBlock = async function ({ endpoint }, block) {
  const randId = Math.random() * 1e6 | 0;
  return new Promise(function (resolve, reject) {
    request({
      url: endpoint,
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      json: true,
      body: { jsonrpc: '2.0', id: randId, method: 'getblock', params: [block, true] },
      timeout: 1500
    }, function (error, response, body) {
      if (error) {
        debug(`getBlock() error: %o`, error);
        return reject(error);
      }

      if (response.statusCode < 200 || response.statusCode > 299) {
        debug(`getBlock() Status was ${response.statusCode}`);
        return reject(new Error(`Status was ${response.statusCode}`));
      }

      if (body.jsonrpc !== '2.0' || body.id !== randId) {
        debug(`getBlock() JSON-RPC response invalid (jsonrpc ${body.jsonrpc}, id ${body.id}, generated id ${randId})`);
        return reject(new Error(`JSON-RPC response invalid (jsonrpc ${body.jsonrpc}, id ${body.id}, generated id ${randId})`));
      }

      return resolve(body.result);
    });
  });
};

const NODE_PING_INTERVAL = 20000; // 20 seconds
const NODE_REFRESH_INTERVAL = 1000 * 60 * 5; // 5 minutes

class Pool {

  constructor(network) {
    this._network = network;
  }

  async init() {
    this._nodes = await getNodes(this._network);
    await this.benchmark();

    this._pingInterval = setInterval(async () => {
      await this.benchmark();
    }, NODE_PING_INTERVAL);

    this._nodeRefreshInterval = setInterval(async () => {
      await this.benchmark();
    }, NODE_REFRESH_INTERVAL);
  }

  async benchmark() {
    const results = await Promise.all(this._nodes.map(benchmarkNode));
    const connected = [];
    for (var i = 0; i < results.length - 1; i++) {
      const { success, blockHeight, roundtrip } = results[i];
      if (success) {
        connected.push(blockHeight);
      }
      this._nodes[i].correct = success;
      this._nodes[i].bestHeight = blockHeight;
      this._nodes[i].lastPing = roundtrip;
    }

    this._nodes = sort((a, b) => {
      const h = b.bestHeight - a.bestHeight;
      if (h === 0) {
        return a.lastPing - b.lastPing;
      }

      return h;
    }, this._nodes);

    this._bestHeight = this._nodes[0].bestHeight;
  }

  getBestNode() {
    return this._nodes[0];
  }

  getStats() {
    if (this._nodes) {
      return {
        all: this._nodes.length,
        correct: this._nodes.filter(n => n.correct).length,
        bestHeight: this._bestHeight
      };
    } else {
      return false;
    }
  }
}
exports.Pool = Pool;