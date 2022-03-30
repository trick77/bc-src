// how to connect to Binance very centralized "DEX". 
import fetch from 'node-fetch'
import WebSocket from 'ws'

const blockQueue = []

const blockHeights = new WebSocket("wss://dex.binance.org/api/ws/$all@blockheight")

const getBlock = async (height, route) => {

  if (route === 1) {
    const res = await fetch(`https://dex.binance.org/api/v1/transactions-in-block/${height}`, {method:'get'})
    const block = res.json()

    return block
  }
  const res = await fetch(`https://dex.binance.org/api/v2/transactions-in-block/${height}`, {method:'get'})
  const block = res.json()

  return block

 }

// Or Subscribe method
const conn = new WebSocket("wss://dex.binance.org/api/ws");
conn.onopen = function(evt) {
    conn.send(JSON.stringify({ method: "subscribe", topic: "blockheight", symbols: ["$all"] }));
}
conn.onmessage = async (evt) => {
  const height = JSON.parse(evt.data).data.h
  if (blockQueue[0] < (height - 100)) {
    const nextReq = blockQueue.shift()
    let data = await getBlock(nextReq, 1)
    if (!data || !data.tx) {
      data = await getBlock(nextReq, 2)
    }
    if (data && data.tx) {
      console.log(`block ${nextReq} has ${data.tx.length} txs`)
    } else {
      console.log(`failed to get block ${height} "${data}"`)
    }
  } else {
    console.log(`loading queue: ${blockQueue.length}`)
  }
  blockQueue.push(height)
}
conn.onerror = function(evt) {
    console.error('an error occurred', evt.data);
};



