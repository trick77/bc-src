'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/**
 * Copyright (c) 2017-present, overline.network developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const { BC_SUPER_COLLIDER } = require('../bc/chainstate');
const { BN } = require('bn.js');
const { getLogger } = require('../logger');
const { getChildBlocks } = require('../bc/tokenDictionary');
const { getDetailsFromMtx, getAllMarkedTxs, getAllTouchedMarkedTxs } = require('../bc/util');

const indexChatDb = exports.indexChatDb = async (persistence, rovers) => {

  const latestBlock = await persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
  if (!latestBlock) {
    console.log(`unable to get latest block to start db update`);
    return false;
  }

  let currentIndexHighHash = await persistence.get(`${BC_SUPER_COLLIDER}.chat.index.high.hash`);
  let currentIndexLowHash = await persistence.get(`${BC_SUPER_COLLIDER}.chat.index.low.hash`);
  let currentIndexHighHeight = await persistence.get(`${BC_SUPER_COLLIDER}.chat.index.high.height`);
  let currentIndexLowHeight = await persistence.get(`${BC_SUPER_COLLIDER}.chat.index.low.height`);

  // index is not found so create new index
  if (!currentIndexHighHeight || !currentIndexLowHeight) {

    currentIndexHighHeight = latestBlock.getHeight();
    currentIndexLowHeight = latestBlock.getHeight();
    currentIndexHighHash = latestBlock.getHash();
    currentIndexLowHash = latestBlock.getHash();

    await persistence.put(`${BC_SUPER_COLLIDER}.chat.index.high.height`, currentIndexHighHeight);
    await persistence.put(`${BC_SUPER_COLLIDER}.chat.index.low.height`, currentIndexLowHeight);
    await persistence.put(`${BC_SUPER_COLLIDER}.chat.index.high.hash`, currentIndexHighHash);
    await persistence.put(`${BC_SUPER_COLLIDER}.chat.index.low.hash`, currentIndexHighHash);
  }

  let block = latestBlock;

  if (currentIndexHighHeight !== latestBlock.getHeight()) {
    currentIndexHighHeight = latestBlock.getHeight();
    currentIndexHighHash = latestBlock.getHash();
  }

  console.log(`indexing database from ${currentIndexHighHeight} to ${currentIndexLowHeight}`);

  if (!block) {
    console.log(`unable to get block by height ${currentIndexHighHeight} : ${currentIndexHighHash}`);
    return false;
  }

  const next = async (b, seen, history) => {

    if (!b) {
      console.log(`no block found`);
      return;
    }

    // iterate through all of the child blocks and pull out marked txs
    for (const childId of rovers) {
      for (const child of getChildBlocks(b, childId.toLowerCase())) {
        if (!seen[child.getHash()]) {
          seen[child.getHash()] = b.getHeight();
          const markedTxs = getAllTouchedMarkedTxs(child).filter(mtx => {
            if (!mtx.index) {
              return mtx;
            }
          }).map(mtx => {
            console.log(mtx);
            return {
              bcHeight: b.getHeight(),
              from: mtx.from,
              to: mtx.to,
              value: new BN(mtx.amount).toString(),
              token: mtx.tokenType,
              chain: mtx.chain
            };
          });
          for (const m of markedTxs) {
            console.log(m);
          }
          history = [].concat(history, markedTxs);
        }
      }
    }

    console.log(`total: ${history.length} ${BC_SUPER_COLLIDER} hash: ${b.getHash()} height: ${b.getHeight()}`);

    let prevBlock = await persistence.getBlockByHash(b.getPreviousHash());

    if (!prevBlock) {
      prevBlock = await persistence.getBlockByHeight(b.getHeight() - 1);
      if (prevBlock && b.getPreviousHash() === prevBlock.getHash()) {
        console.log(`indexing parent...${prevBlock.getHeight()}`);
        await persistence.putBlock(prevBlock, 0, BC_SUPER_COLLIDER, { saveHeaders: true });
      }
    }

    if (prevBlock && prevBlock.getHeight() > 6760000) {
      return next(prevBlock, seen, history);
    } else {
      return history;
    }
  };

  const indexHistory = await next(block, {}, []);

  const highest = indexHistory[0];

  const table = {};

  console.log(`built ledger of ${indexHistory.length}`);

  for (const record of indexHistory.reverse()) {
    console.log(`${record.bcHeight} : ${record.token} from: ${record.from} -> to: ${record.to}`);
    const { token, value, from, to, bcHeight, chain } = record;
    const chatVersion = 1;
    const iterator = 1;
    const val = token === 'emb' ? 'emb-0' : token + '-' + value;

    // not emb as that will use the marked db section
    if (token !== 'emb') {

      const fromKey = `${BC_SUPER_COLLIDER}.chat.${chatVersion}.${iterator}.${from}`;
      const toKey = `${BC_SUPER_COLLIDER}.chat.${chatVersion}.${iterator}.${to}`;
      const fromKeyHas = await persistence.get(fromKey);
      const toKeyHas = await persistence.get(toKey);

      if (fromKeyHas) {
        const values = fromKeyHas.split(':');
        if (values.indexOf(val) > -1) {
          values.splice(values.indexOf(val), 1);
        }
        if (values.length === 0) {
          await persistence.del(fromKey);
        } else {
          await persistence.put(fromKey, values.join(':'));
          table[fromKey] = values;
        }
      }

      if (toKeyHas) {
        const values = toKeyHas.split(':');
        if (values.indexOf(val) < 0) {
          values.push(val);
        }
        table[toKey] = values;
        await persistence.put(toKey, values.join(':'));
      } else {
        table[toKey] = [val];
        await persistence.put(toKey, [val].join(':'));
      }
    }
  }

  require('fs').writeFileSync('output_chat.json', JSON.stringify(table, null, 2));
  return;
};