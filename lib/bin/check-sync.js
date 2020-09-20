'use strict';

/* eslint-disable */

const { aperture, reverse } = require('ramda');
const { default: RocksDb } = require('../persistence/rocksdb');
const { isValidBlock, validateBlockSequence } = require('../bc/validation');
const { ROVER_RESYNC_PERIOD, ROVER_SECONDS_PER_BLOCK } = require('../rover/utils');

const process = require('process');
const path = require('path');
const fs = require('fs');
// const { inspect } = require('util')

process.env.BC_LOG = 'error';
process.env.BC_DEBUG = true;

process.on('unhandledRejection', e => {
  console.error(e.stack);
});

(async function () {
  if (process.argv.length < 4) {
    console.log(`Usage: node ./lib/bin/${process.argv[1]} <db_path> <rover> <?check_from_height>`);
  }

  const blocks = [];
  const dbp = path.resolve(process.argv[2]);
  if (!fs.existsSync(dbp)) {
    console.log(`Data folder ${dbp} does not exist`);
    process.exit(1);
  }

  if (!['btc', 'eth', 'lsk', 'neo', 'wav'].includes(process.argv[3].toLowerCase())) {
    console.log(`${process.argv[3]} is not a valid rover name`);
    process.exit(2);
  }

  const roverName = process.argv[3].toLowerCase();
  let newestHeight;
  const p = new RocksDb(dbp);
  await p.open();
  if (process.argv.length > 4) {
    newestHeight = parseInt(process.argv[4], 10);
  } else {
    const latest = await p.get(`${roverName}.block.latest`);
    if (!latest) {
      console.log(`Latest height not provided and could not get '${roverName}.block.latest'`);
      process.exit(4);
    }
    newestHeight = latest.getHeight();
  }

  let nextNum = newestHeight;
  let next = await p.get(`${roverName}.block.${nextNum}`);
  console.log(`Got block ${nextNum}`);

  const limit = ROVER_RESYNC_PERIOD / ROVER_SECONDS_PER_BLOCK[roverName];
  while (true) {
    if (nextNum < newestHeight - limit) {
      break;
    }

    nextNum = nextNum - 1;
    next = await p.get(`${roverName}.block.${nextNum}`);

    if (next) {
      console.log(`Got block ${nextNum}`);
    } else {
      console.log(`Could not get block ${nextNum}`);
    }
  }

  // const { range, reverse } = require('ramda')
  // for (const num of reverse(range(newestHeight - 15, newestHeight + 1))) {
  //   await p.del(`btc.block.${num}`)
  // }

  // const latest = await p.getBulk(['bc.block.40', 'bc.block.41'])
  // console.log(inspect(latest.map(b => b.toObject()), {depth: 3}))
})();