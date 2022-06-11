'use strict';

const fetch = require('node-fetch');
const btoa = require('btoa');
const util = require('util');
const tty = require('tty');

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;
if (process.argv.length < 3) {
  console.log('err - rpc method not provided');
  process.exit(1);
}

// replace localhost:3000 with the host and port you are running the miner on local
const rpcHost = process.env.BC_RPC_ADDRESS || 'http://localhost:3000';
const scookie = process.env.BC_RPC_SCOOKIE || 'testCookie123';
let url = `${rpcHost}/rpc`;

let headers = {
  'Content-Type': 'application/json',
  Authorization: 'Basic ' + btoa(`:${scookie}`)
};
let body = JSON.stringify({
  jsonrpc: '2.0',
  id: Math.random() * 1e6 | 0,
  method: process.argv[2],
  params: process.argv.slice(3, process.argv.length)
});

fetch(url, { method: 'post', headers, body }).then(response => {
  if (response.status === 401) {
    throw new Error('Access denied - check if the BC_RPC_SCOOKIE is correctly set');
  }

  if (response.status - 200 > 100) {
    throw new Error(`Error occured: status code: ${response.status}, explanation: ${response.statusText}`);
  }

  response.json().then(function (data) {
    const output = tty.isatty(process.stdout.fd) ? util.inspect(data, false, null, true) : JSON.stringify(data);
    console.log(output);
  }).catch(e => {
    console.error(e);
  });
});