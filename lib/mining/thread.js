#! /usr/bin/env node
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

const process = require('process');

/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const {
  getExpFactorDiff,
  getNewPreExpDifficulty,
  getNewestHeader,
  getNewBlockCount,
  mine
} = require('./primitives');
const {
  BlockchainHeaders,
  BlockchainHeader,
  BcBlock
} = require('../protos/core_pb');
const logging = require('../logger');
const globalLog = logging.getLogger(__filename);

//-------------------------------------------------------------------------------------------------------------

const { createMinerMemory, destroyMinerMemory, runMiner, gpu_mutex } = require('../../gpu_dev')

function mine_gpu(currentTimestamp, work, miner, merkleRoot, threshold, difficultyCalculator, reportType) {
  const tsStart = ts.now();
  var now = tsStart / 1000 << 0;
  var difficulty = difficultyCalculator(now);
  globalLog.info('calling GPU miner...');
  const solution = runMiner(miner, merkleRoot, work, now, difficulty);
  globalLog.info('solution.distance=' + solution.distance);
  const tsStop = ts.now();
  var res = {
    distance: solution.distance,
    nonce: solution.nonce.toString(),
    timestamp: now,
    difficulty: solution.difficulty,
    // NOTE: Following fields are for analyses only
    iterations: solution.iterations,
    timeDiff: tsStop - tsStart
    // outhash: solution.result_blake2bl
  };
  globalLog.info('gpu result: ' + res.distance + ' ' + res.timestamp);

  return res;
}

//-------------------------------------------------------------------------------------------------------------

// setup logging of unhandled rejections
process.on('uncaughtException', err => {
  // $FlowFixMe
  console.trace(err);
  //globalLog.error(`error, trace:\n${err.stack}`)
  //globalLog.error(`rejected promise, trace:\n${err.message}`)
});
process.on('unhandledRejection', err => {
  // $FlowFixMe
  console.trace(err);
  globalLog.error(`error, trace:\n${err.stack}`);
  globalLog.error(`rejected promise, message:\n${err.message}`);
});
const LRUCache = require('lru-cache');
const ts = require('../utils/time').default; // ES6 default export
const cluster = require('cluster');
const { mean, min, max } = require('ramda');
const fkill = require('fkill');

const { config } = require('../config');
const { EventEmitter } = require('events');

const BC_NETWORK = process.env.BC_NETWORK || 'main';
const dataDirSuffix = BC_NETWORK === 'main' ? '' : `_${BC_NETWORK}net`;
const DATA_DIR = `${process.env.BC_DATA_DIR || config.persistence.path}${dataDirSuffix}`;
const CHAINSTATE_DIR = process.env.BC_CHAINSTATE_DIR ? process.env.BC_CHAINSTATE_DIR : DATA_DIR;
const MINER_RECYCLE_INTERVAL = 1660000 + Math.floor(Math.random() * 10) * 10000;
const RADIAN_LOGGING_INTERVAL = 26600;
const ROVERS = Object.keys(require('../rover/manager').rovers);
let numCPUs = max(1, Number(require('os').cpus().length) - 1);
let targetSegment = 0;
let EmblemBalance = 0;

const BC_MINER_WORKERS = exports.BC_MINER_WORKERS = process.env.BC_MINER_WORKERS !== undefined ? parseInt(process.env.BC_MINER_WORKERS) : numCPUs;
// this is set lower than the traditional minimum difficulty in primirtives for smaller processors
const BC_MINIMUM_DIFFICULTY = !isNaN(process.env.BC_MINIMUM_DIFFICULTY) ? BigInt(process.env.BC_MINIMUM_DIFFICULTY) : BigInt(296112262029662);
const BC_STAT_SAMPLE_COUNT = min(3, Math.floor(BC_MINER_WORKERS / 2));

const knownWork = LRUCache({
  max: BC_MINER_WORKERS * 100
});

const settings = {
  maxWorkers: 2
};

const sendWorker = (worker, msg) => {
  return new Promise((resolve, reject) => {
    try {
      return worker.send(msg, resolve);
    } catch (err) {
      return reject(err);
    }
  });
};

const rebaseWorkers = segment => {
  try {
    if (segment) {
      fkill('bcworker' + segment, { force: true, silent: true }).then(() => {
        globalLog.debug(`segment disabled`);
      }).catch(e => {
        globalLog.debug(`segment disabled`);
      });
    } else {
      targetSegment = 0;
      // clean up pending working sends
      // remove any event listeners
      //for (var id in cluster.workers) {
      //  cluster.workers[id].removeAllListeners();
      //}
      Promise.all([fkill('bcworker4', { force: true, silent: true }), fkill('bcworker3', { force: true, silent: true }), fkill('bcworker2', { force: true, silent: true }), fkill('bcworker1', { force: true, silent: true })]).then(() => {
        globalLog.debug(`bcworkers exited`);
      }).catch(e => {
        globalLog.debug(e);
      });
    }
  } catch (err) {
    globalLog.error(err);
  }
};

const shutdown = code => {
  globalLog.info(`shutting down worker pool ${code}`);
  try {
    rebaseWorkers();
  } catch (err) {
    process.exit();
  }
  process.exit();
};

if (cluster.isMaster) {
  // setup logging of unhandled rejections
  process.on('uncaughtException', err => {
    // $FlowFixMe
    console.trace(err);
    //globalLog.error(`error, trace:\n${err.stack}`)
    //globalLog.error(`rejected promise, trace:\n${err.message}`)
  });
  const stats = [];
  const workIds = [];
  let lastStat = 0;
  let unformattedMetric = 0;
  let minerKey = false;
  process.title = 'bcpool';

  // every 20 minutes take a sample
  setInterval(() => {
    stats.unshift();
  }, 20 * 60 * 1000);

  globalLog.info(`rovers initialized: ${ROVERS}`);

  const eachWorker = (callback, i) => {
    let w = cluster.workers;
    if (i) {
      w = w.slice(0, i);
    }
    for (const id in cluster.workers) {
      callback(cluster.workers[id]);
    }
  };

  const currentWork = [];
  const createThread = function () {
    const worker = cluster.fork();
    return worker;
  };

  const applyEvents = worker => {
    worker.on('message', data => {
      if (data.type === 'getWork') {
        globalLog.debug(`worker ${worker.id}-${worker.process.pid} requesting rebase`);
        if (currentWork.length < 1) {
          return;
        }
        const w = currentWork.pop();
        if (w && w.isConnected()) {
          worker.send(w);
        }
      } else if (data.type === 'putMetric') {
        globalLog.debug(`putMetric received from worker: ${data.sampleData}`);
        stats.unshift(Math.floor(data.data.iterations / data.data.timeDiff));
        if (stats.length > BC_STAT_SAMPLE_COUNT) {
          stats.pop();
        }
      } else if (data.type === 'putWork') {
        // clear the current work array
        globalLog.debug(`putWork received from worker: ${data.sampleData}`);
        currentWork.length = 0;
        stats.unshift(Math.floor(data.data.iterations / data.data.timeDiff));
        if (stats.length > BC_STAT_SAMPLE_COUNT) {
          stats.pop();
        }
        if (knownWork.has(data.workId)) {
          //globalLog.info(`duplicate solution for work ${data.workId} from worker ${worker.id}-${worker.process.pid}`)
          return;
        }
        knownWork.set(data.workId, true);
        if (!data.sampleData) {
          process.send({
            type: 'solution',
            data: data.data,
            workId: data.workId
          });
          rebaseWorkers();
        }
      } else if (data.type === 'heartbeat') {
        globalLog.info(`heartbeat from worker ${worker.id}-${worker.process.pid} -> CHAINSTATE_DIR: ${data.dir}`);
      }
    });
    return worker;
  };

  for (let i = 0; i < BC_MINER_WORKERS; i++) {
    const worker = applyEvents(createThread());
    // await sendWorker(worker, data.data)
  }

  process.once('SIGTERM', () => {
    shutdown(0);
  });
  process.once('SIGINT', () => {
    shutdown(0);
  });
  process.once('exit', () => {
    shutdown(0);
  });

  cluster.on('exit', w => {
    const worker = applyEvents(createThread());
  });

  cluster.on('online', w => {
    globalLog.debug(`online: ${w.id}-${w.process.pid}`);
  });

  // recieve message from controller process (not worker)
  process.on('message', data => {
    const workId = data.data ? data.data.workId : data.workId;
    if (workId) {
      process.send({
        type: 'accept',
        speed: unformattedMetric,
        workId: workId
      });
    }
    if (data.type === 'config') {
      settings.maxWorkers = data.maxWorkers || settings.maxWorkers;
      if (data.emblemBalance) {
        EmblemBalance = data.emblemBalance;
      }

      if (data.emblemPerformance && data.minerKey) {
        settings.emblemPerformance = data.emblemPerformance;
        settings.minerKey = data.minerKey;
        globalLog.info(`Emblem (EMB) performance of ${data.minerKey} increased +${data.emblemPerformance}%`);
      } else {
        if (data.minerKey) {
          minerKey = data.minerKey;
          settings.minerKey = data.minerKey;
          globalLog.info(`no Emblems (EMB) associated <- ${data.minerKey}`);
        } else {
          globalLog.info(`no Emblems (EMB) associated with miner`);
        }
      }
    } else if (data.type === 'accept') {
      globalLog.info(`work id ${data.workId} confirmed from worker`);
    } else if (data.type === 'work') {
      // clear current work for new work
      currentWork.length = 0;
      let connected = 0;
      if (stats.length < 3) {
        globalLog.debug(`created RADIAN challenge ${stats.length} / ${BC_STAT_SAMPLE_COUNT}`);
        data.data.sampleData = true;
      } else {
        data.data.sampleData = false;
      }
      eachWorker(worker => {
        // DEBUG
        globalLog.debug(`sending work to worker ${worker.id}-${worker.process.pid}`);
        currentWork.push(data.data);
        if (worker.isConnected()) {
          connected++;
          worker.send(data.data);
        }
      });
      if (connected < 1) {
        globalLog.info(`workers disconnected...restarting...`);
        rebaseWorkers();
      }
    } else if (data.type === 'segment') {
      if (BC_MINER_WORKERS > 2) {
        if (targetSegment === 0) {
          targetSegment = Math.floor(Math.random() * 4) + 1;
        }
        // LDL
        globalLog.debug(`cluster rebasing segment ${targetSegment}`);
        rebaseWorkers(targetSegment);
        // let m = 1
        //eachWorker((w) => {
        //  // DEBUG
        //  if (m % 3 === 0) {
        //    m = 1
        //    if (w && w.isConnected()) {
        //      w.send({ workId: false })
        //    }
        //  } else {
        //    m = m + 1
        //  }
        //})
      } else {
        // dont interupt small node
        rebaseWorkers();
        //eachWorker((w) => {
        //  // DEBUG
        //    if (w && w.isConnected()) {
        //      connected++
        //      w.send({ workId: false })
        //    }
        //})
        //if (connected < 1) {
        //  globalLog.info(`worker disconnected...restarting...`)
        //  rebaseWorkers()
        //}
      }
    } else if (data.type === 'rebase') {
      let connected = 0;
      eachWorker(w => {
        if (w && w.isConnected()) {
          connected++;
          w.send({ workId: false });
        }
      });
      if (connected < 1) {
        globalLog.debug(`worker disconnected...restarting...`);
        rebaseWorkers();
      }
    }
  });

  setInterval(() => {
    if (stats.length >= 3) {
      let workerLimit = 1;
      if (cluster.workers !== undefined && Object.keys(cluster.workers).length > 1) {
        workerLimit = Object.keys(cluster.workers).length;
      }
      const distancePerSecond = mean(stats) * 1000;
      const distancePerRadianSecond = Math.floor(distancePerSecond / 6.283);
      const coreCountAdjustment = distancePerRadianSecond * (numCPUs + 1);
      const metricToString = String(coreCountAdjustment / 100);
      let formattedMetric = metricToString.indexOf('.') > -1 ? metricToString.split('.')[0] + '.' + metricToString.split('.')[1].slice(0, 2) : metricToString + '.00';
      unformattedMetric = Number(formattedMetric);

      let percEmb = settings.emblemPerformance ? settings.emblemPerformance : 0;
      let sizeUnit = 'k';

      if (Number(formattedMetric) > 1000000000) {
        formattedMetric = Number(formattedMetric) / 1000000000;
        sizeUnit = 't';
      } else if (Number(formattedMetric) > 100000) {
        formattedMetric = Number(formattedMetric) / 100000;
        sizeUnit = 'g';
      } else if (Number(formattedMetric) > 1000) {
        formattedMetric = Number(formattedMetric) / 1000;
        sizeUnit = 'm';
      }

      if (formattedMetric !== undefined && formattedMetric > 0) {
        const addr = settings.minerKey ? settings.minerKey : minerKey;
        if (addr) {
          console.table([{
            "NRG MINER ADDRESS": `${addr}`,
            "EMBLEM INCREASE": `+${percEmb}%`,
            "RADIAN COLLISIONS (RAD/s)": `${formattedMetric} ${sizeUnit}RAD/s`,
            "CLUSTER": `${Object.keys(cluster.workers).length} (${stats.length})`
          }]);
          //globalLog.info(`\n\n EMBLEM ♢ PERF. +${percEmb}% <- MINER ${addr} <- COLLISION RATE: ${formattedMetric} ${sizeUnit}RAD/s | T: ${Object.keys(cluster.workers).length}\n`)
        } else {
          console.table([{
            "EMBLEM INCREASE": `+${percEmb}%`,
            "RADIAN COLLISIONS (RAD/s)": `${formattedMetric} ${sizeUnit}RAD/s`,
            "CLUSTER": `${Object.keys(cluster.workers).length} (${stats.length})`
          }]);
          //globalLog.info(`\n\n EMBLEM ♢ PERF. +${percEmb}% | COLLISION RATE: ${formattedMetric} ${sizeUnit}RAD/s | T: ${Object.keys(cluster.workers).length}\n`)
        }
      }
    } else if (stats.length < 3 && lastStat !== stats.length) {
      lastStat = stats.length;
      globalLog.info(`\n\n  sampling PoD performance in radians <- ${stats.length}/${BC_STAT_SAMPLE_COUNT}\n`);
    }
  }, RADIAN_LOGGING_INTERVAL);

  globalLog.info('pool controller ready ' + process.pid);
} else {
  /**
   * Miner woker entrypoint
   */

  // 20% of workers will run without interuption on the first rovered block
  process.title = 'bcworker' + (Math.floor(Math.random() * 4) + 1);

  process.once('SIGTERM', () => {
    shutdown(0);
  });
  process.once('SIGINT', () => {
    shutdown(0);
  });
  // process.once('exit', () => { shutdown(0) })
  const emitter = new EventEmitter();
  let working = false;

  const main = () => {
    process.on('message', ({
      workId,
      currentTimestamp,
      offset,
      work,
      minerKey,
      merkleRoot,
      newestChildBlock,
      difficulty,
      difficultyData,
      sampleData
    }) => {

      if (sampleData) {
        globalLog.debug(`running thread analyses for worker ${process.pid}`);
        difficulty = String(BC_MINIMUM_DIFFICULTY);
      }

      if (!workId) {
        globalLog.debug(`${process.pid} <- recieved request to rebase`);
        process.exit();
      }

      if (working) {
        globalLog.debug(`${process.pid} -> yielding request for new work`);
        return;
      }

      working = true;
      globalLog.debug(`${process.pid} mining work id: ${workId}`);

      ts.offsetOverride(offset);
      // Deserialize buffers from parent process, buffer will be serialized as object of this shape { <idx>: byte } - so use Object.values on it
      const deserialize = (buffer, clazz) => clazz.deserializeBinary(new Uint8Array(Object.values(buffer).map(n => parseInt(n, 10))));

      // function with all difficultyData closed in scope and
      // send it to mine with all arguments except of timestamp and use it
      // each 1s tick with new timestamp
      const difficultyCalculator = function () {
        // Proto buffers are serialized - let's deserialize them
        const {
          lastPreviousBlock,
          newBlockHeaders
        } = difficultyData;
        const lastPreviousBlockProto = deserialize(lastPreviousBlock, BcBlock);
        const newBlockHeadersProto = deserialize(newBlockHeaders, BlockchainHeaders);

        // return function with scope closing all deserialized difficulty data
        return function (timestamp) {
          const newBlockCount = parseInt(lastPreviousBlockProto.getHeight(), 10) === 1 ? 1 : getNewBlockCount(lastPreviousBlockProto.getBlockchainHeaders(), newBlockHeadersProto);

          const preExpDiff = getNewPreExpDifficulty(timestamp, lastPreviousBlockProto, getNewestHeader(newBlockHeadersProto), newBlockCount);
          return getExpFactorDiff(preExpDiff, lastPreviousBlockProto.getHeight()).toString();
        };
      };

      try {

        emitter.once('solution', res => {
          //globalLog.info(`solution recieved from ${process.pid}`)
          working = false;
          if (!res.nonce) {
            process.send({
              type: 'putMetric',
              data: res,
              workId: workId,
              sampleData: sampleData
            });
          } else {
            process.send({
              type: 'putWork',
              data: res,
              workId: workId,
              sampleData: sampleData
            }, () => {
              globalLog.debug(`purposed candidate found: ${JSON.stringify(res, null, 0)}`);
            });
          }
        });

//-------------------------------------------------------------------------------------------------------------
        //const solution = mine(currentTimestamp, work, minerKey, merkleRoot, difficulty, difficultyCalculator(), emitter);

        const solution = mine_gpu(
          currentTimestamp,
          work,
          minerKey,
          merkleRoot,
          difficulty,
          difficultyCalculator()
        )

//-------------------------------------------------------------------------------------------------------------

      } catch (e) {
        globalLog.warn(`mining failed -> reason: ${e.message}, stack ${e.stack}`);
        process.exit();
      }
    });
  };

  main();
}
