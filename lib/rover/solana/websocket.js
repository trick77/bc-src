'use strict';

//
//
//

const RPC_URL = process.argv[2];
const SOCKET_URL = process.argv[3];

const WebSocket = require('ws');
const fetch = require('node-fetch');

const subscribeMessage = JSON.stringify({
  "jsonrpc": "2.0",
  "id": 1,
  "method": "slotSubscribe",
  "params": []
});

const headers = {
  'Content-Type': 'application/json'
};

const accountStats = {
  seen: []
};
const blockTree = {};
const blockStats = {
  uniqueAccounts: 0,
  highest: 0,
  indexed: 0,
  transactions: 0,
  biggestBlock: {
    height: 0,
    transactions: 0
  }
};

const getBlockAtSlot = async slot => {
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: "getBlock",
    params: [slot, {
      encoding: "json",
      transactionDetails: "full",
      rewards: false
    }]
  });
  const res = await fetch(RPC_URL, { method: 'post', headers, body });
  const data = await res.json();
  if (data && data.result && data.result.transactions) {
    return {
      status: "success",
      slot: slot,
      data: data.result
    };
  } else {

    console.log(data);
    return {
      status: "failure",
      slot: slot,
      data: {}
    };
  }
};

const blockQueue = [];

const getMissingGaps = obj => {

  const sort = Object.keys(obj).sort((a, b) => {
    if (a > b) {
      return 1;
    }
    if (a < b) {
      return -1;
    }
    return 0;
  });

  const gaps = sort.reduce((all, a, i) => {

    const next = sort[i + 1];
    if (next) {
      if (next - a !== 1) {
        const getSlot = obj[a] + 1;
        all.push([a, next, next - a, getSlot]);
      }
    }
    return all;
  }, []);
  if (gaps.length > 0) {
    console.log(gaps);
  }
};

const processTransactions = block => {

  const transactions = block.transactions;
  for (const tx of transactions) {
    const accountKeys = tx.transaction.message.accountKeys;
    for (const key of accountKeys) {
      if (accountStats.seen.indexOf(key) < 0) {
        accountStats.seen.push(key);
      }
    }
  }
};
const handleMessage = async msg => {
  try {
    const d = JSON.parse(msg.data);
    if (d && d.params && d.params.result) {
      const res = await getBlockAtSlot(d.params.result.slot - 5000);
      if (res && res.status === 'success') {
        const height = res.data.blockHeight;
        const transactions = res.data.transactions;
        processTransactions(res.data);
        blockTree[height] = res.slot;
        blockStats.indexed++;
        if (height > blockStats.highest) {
          blockStats.highest = height;
        }
        blockStats.transactions = blockStats.transactions + transactions.length;
        if (blockStats.biggestBlock.transactions < transactions.length) {
          blockStats.biggestBlock.height = height;
          blockStats.biggestBlock.transactions = transactions.length;
        }
        getMissingGaps(blockTree);

        blockStats.uniqueAccounts = accountStats.seen.length;
        console.log(blockStats);
      } else {
        console.log(`slot ${res.slot} failed`);
      }
    }
  } catch (err) {
    console.trace(err);
  }
};

const connect = () => {
  const wss = new WebSocket(SOCKET_URL);
  wss.onopen = () => {
    console.log('connected');
    wss.send(subscribeMessage);
  };

  wss.onerror = e => {
    console.trace(e);
    setTimeout(() => {
      connect();
    }, 1000);
  };

  wss.onclose = () => {
    console.log('closed...reconnecting');
    setTimeout(() => {
      connect();
    }, 1000);
  };

  wss.onmessage = handleMessage;
};

connect();