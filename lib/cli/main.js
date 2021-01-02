#! /usr/bin/env node
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});


// $FlowFixMe
console.warn = () => {}; // eslint-disable-line no-console


/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const colors = require('colors');
const debug = require('debug')('bcnode:cli:main');
const rmrf = require('rimraf');
const del = require('del');
const path = require('path');
const process = require('process');
const program = require('commander');
const unzip = require('unzip');
const nodeFetch = require('node-fetch');
const fs = require('fs');
const Raven = require('raven');
const availCPUs = Number(require('os').cpus().length) - 1 > 0 ? Number(require('os').cpus().length) - 1 : 1;

const uncaughtExceptionHandler = err => {
  // eslint-disable-next-line no-console
  console.trace(err);
  process.exit(3);
};

// Remove pre OT
process.env.UV_THREADPOOL_SIZE = 64;
process.on('uncaughtException', uncaughtExceptionHandler);

const { config } = require('../config');
const logging = require('../logger');
const { ensureDebugDir } = require('../debug');
const { getVersion } = require('../helper/version');
const { getOsInfo } = require('../helper/os');
const { cmd: cmdConfig } = require('./cmd/config');
const { cmd: cmdInfo } = require('./cmd/info');
const { cmd: cmdStart } = require('./cmd/start');
const { cmd: cmdBalance } = require('./cmd/balance');
const { cmd: cmdNewTx } = require('./cmd/newTx');
const { MINER_KEY_REGEX } = require('./minerKey');

// $FlowFixMe
// TODO fix after native extensions usable again
// const native = require('../../native/index.node')

const BC_NETWORK = process.env.BC_NETWORK || 'main';
const dataDirSuffix = BC_NETWORK === 'main' ? '' : `_${BC_NETWORK}net`;
const DATA_DIR = `${process.env.BC_DATA_DIR || config.persistence.path}${dataDirSuffix}`;
const LOG_DIR = path.resolve(__dirname, '..', '..', '_logs');
const ROVERS = Object.keys(require('../rover/manager').rovers);
const figlet = require('figlet');
let BC_DEV_MODE = process.env.BC_DEV_MODE && process.env.BC_DEV_MODE !== 'false' && process.env.BC_DEV_MODE !== '0' ? process.env.BC_DEV_MODE : false;
if (BC_DEV_MODE) {
  if (BC_DEV_MODE === 'true' || BC_DEV_MODE === '1' || BC_DEV_MODE.indexOf('http') > 1) {
    // INTERNAL DEVELOPER: BC_DEV_MODE = "https://bc-ephemeral.s3.amazonaws.com/_easysync_db.zip"
    BC_DEV_MODE = "https://community.multichains.org/_easysync_db.zip";
  }
}

const getDeveloperMultichain = async (url, path) => {

  if (!url || !path) {
    return Promise.resolve(true);
  }

  return new Promise((resolve, reject) => {
    figlet('BC', (e, data) => {
      if (e) {
        return reject(e);
      }
      console.log('');
      console.log(data);
      rmrf(path, err => {
        if (err) {
          return reject(err);
        }
        const tempPath = 'state.zip';
        console.log(`  WARNING: OVERLINE DEVELOPER MODE (BC_DEV_MODE=true)`);
        console.log(``);
        console.log(`           !!! This mode is for testing only !!!`);
        console.log(`         `);
        try {
          nodeFetch(url).then(res => {
            const dest = fs.createWriteStream(tempPath);
            const headers = res.headers.raw();
            let downloadSize = false;
            let downloadSizeHuman = false;
            let statusDownload = false;
            let statusZip = false;
            let prevDownloads = [];
            let prevDownloadSize = 0;
            let estDownloadTime = 0;

            if (headers && headers['content-length']) {
              downloadSize = headers['content-length'];
              downloadSizeHuman = parseFloat(downloadSize / 1000000000).toFixed(2);
            }

            try {

              statusDownload = setInterval(() => {
                if (downloadSize) {
                  const stats = fs.statSync(tempPath);
                  if (stats && stats['size']) {
                    const size = stats['size'] / downloadSize * 100;
                    const perc = parseFloat(size).toFixed(2);
                    if (prevDownloadSize < 1) {
                      prevDownloadSize = stats['size'];
                    } else {
                      const diff = stats['size'] - prevDownloadSize;
                      prevDownloads.push(diff);
                      prevDownloadSize = stats['size'];
                    }
                    if (prevDownloads.length > 5) {
                      let sum = 0;
                      for (let t of prevDownloads) {
                        sum = sum + t;
                      }
                      const avgSizePerSec = sum / prevDownloads.length;
                      const remaining = downloadSize - stats['size'];
                      const minutes = Math.floor(remaining / avgSizePerSec / 60);
                      const seconds = Math.floor(remaining / avgSizePerSec);
                      let interval = minutes + ' minutes';

                      if (minutes < 1) {
                        interval = seconds + ' seconds';
                      } else if (minutes === 1) {
                        interval = minutes + ' minute';
                      }
                      estDownloadTime = ` (est. ${interval})`;
                      if (prevDownloads.length > 64) {
                        prevDownloads.shift();
                      }
                    } else {
                      estDownloadTime = '';
                    }
                    process.stdout.write(`\r (1/2) Multichain archive ${downloadSizeHuman}GB${estDownloadTime} ${perc}%...      `);
                  }
                }
              }, 1000);

              res.body.pipe(dest).on('finish', () => {
                clearInterval(statusDownload);
                console.log(``);
                statusZip = setInterval(() => {
                  let files = [];
                  if (fs.existsSync('_data/db')) {
                    files = fs.readdirSync('_data/db');
                  } else {
                    files = fs.readdirSync('_data');
                  }
                  if (files && files.length) {
                    process.stdout.write(`\r (2/2) Parsed ${files.length} segments...  `);
                  }
                }, 1000);
                const zip = unzip.Extract({ path: '.' });
                fs.createReadStream(tempPath).pipe(zip);
                zip.once('close', () => {
                  console.log('');
                  clearInterval(statusZip);
                  del.sync(tempPath, { force: true });
                  resolve(true);
                });
                zip.once('error', e => {
                  clearInterval(statusZip);
                  del.sync(tempPath, { force: true });
                  resolve(true);
                });
              }).on('error', e => {
                clearInterval(statusDownload);
                clearInterval(statusZip);
                del.sync(tempPath, { force: true });
                return reject(err);
              });
            } catch (err) {
              clearInterval(statusDownload);
              clearInterval(statusZip);
              reject(e);
            }
          });
        } catch (err) {
          reject(err);
        }
      });
    });
  });
};

const main = exports.main = async (args = process.argv) => {
  process.title = 'bc-main';

  const version = getVersion();
  const versionString = `${version.npm}#${version.git.short}`;

  if (BC_DEV_MODE) {
    await getDeveloperMultichain(BC_DEV_MODE, DATA_DIR);
  }

  program
  // $FlowFixMe
  .version(versionString).usage('<cmd>').action(cmd => {
    // eslint-disable-next-line no-console
    console.log(colors.red(`Invalid command '${cmd}'`));
    return program.help();
  });

  // COMMAND - config
  program.command('config').description('Configuration file(s)').usage('[opts]').option('--show', 'Show config file used').action(cmd => {
    return cmdConfig(cmd);
  });

  // COMMAND - info
  program.command('info').description('Various metrics').usage('[opts]').option('--all', 'Show all', false).option('--dirs', 'Path of directories used', false).option('--machine', 'Machine info', false).action(cmd => {
    return cmdInfo(cmd);
  });

  // COMMAND - balance
  program.command('balance <address>').description('Confirmed/unconfirmed address NRG balance').usage('balance <address> <options>').action((address, cmd) => {
    return cmdBalance(cmd, address);
  });

  // COMMAND - start
  program.command('start').description('Start Block Collider').usage('[opts]').option('--miner-key [key]', 'Miner key', MINER_KEY_REGEX, process.env.BC_MINER_KEY).option('-n, --node', 'Start P2P node').option('--rovers [items]', 'start rover', ROVERS.join(', ')).option('-R, --no-rovers', 'do not start any rover').option('--rpc', 'enable RPC').option('--ui', 'enable Web UI').option('--overline', 'enable Overline transaction mining [rover developers program only]').option('--fix', 'enable FIX4 [rover developers program only]').option('--ws', 'enable WebSocket').option('--relay-mode', 'run relay-only mode', false).option('-s, --scookie <scookie>', 'Set RPC secure cookie').action(cmd => {
    return cmdStart(cmd);
  });

  // COMMAND - balance
  program.command('newTx <from> <to> <amount> <txFee> <privateKey>').description('Make a transaction').usage('newTx <from> <to> <amount> <txFee> <privateKey>').action((from, to, amount, txFee, privateKey, cmd) => {
    return cmdNewTx(cmd, from, to, amount, txFee, privateKey);
  });

  // Initialize required directories
  initDirs();

  // Initialize JS logger
  const logger = logging.getLogger(__filename);

  // Initialize Rust logger
  // native.initLogger()

  if (args.length < 3) {
    logger.log(colors.red('No command specified'));
    return program.help();
  }

  // ---------------------------
  // CORE ERROR HANDLER SECTION
  // ---------------------------

  // Map of error handlers
  const errorHandlers = {
    // Uncaught exception
    uncaughtException: [],

    // Unhadled execption
    unhandledRejection: []

    // Generic console handler
  };const consoleErrorHandler = {
    handle: (type, err) => {
      console.trace(err);
      logger.log('error', type, err);
    }
  };

  errorHandlers.uncaughtException.push(consoleErrorHandler);
  errorHandlers.unhandledRejection.push(consoleErrorHandler);

  // If sentry.io is enabled add to list of additionalErrorHandlers
  if (config.sentry.enabled) {
    const osInfo = getOsInfo();
    // Create additional error handler object
    const sentryErrorHandler = {
      // Initialization - used for startup, one-time, handler init
      init: () => {
        Raven.config(config.sentry.url, {
          release: version.git.long,
          tags: {
            'package.version': version.npm,
            'os.arch': osInfo.arch,
            'os.cpu': osInfo.cpus[0].model,
            'os.hostname': osInfo.hostname,
            'os.mem': osInfo.mem,
            'os.platform': osInfo.platform,
            'os.release': osInfo.release,
            'os.type': osInfo.type
          }
        }).install();
      },
      // Handle error
      handle: (type, err) => {
        Raven.captureException(err);
      }

      // Add sentry to list of error handlers
    };errorHandlers.uncaughtException.push(sentryErrorHandler);
    errorHandlers.unhandledRejection.push(sentryErrorHandler);
  }

  // Initialize error handlers
  initErrorHandlers(logger, errorHandlers);

  // Unregister global handler now
  process.removeListener('uncaughtException', uncaughtExceptionHandler);

  // ---------------------
  // CHECK REMOTE VERSION
  // ---------------------
  return program.parse(args);
  // return getRemoteVersion()
  //   .then((gitVersion) => {
  //     const versionObj = {
  //       local: {
  //         npm: version.npm,
  //         git: version.git.short
  //       },
  //       remote: {
  //         npm: gitVersion
  //       }
  //     }
  //
  //     debug(`Version: ${JSON.stringify(versionObj, null, 2)}`)
  //     return Promise.resolve([
  //       semver.satisfies(versionObj.local.npm, `>=${versionObj.remote.npm}`),
  //       versionObj.local.npm,
  //       versionObj.remote.npm
  //     ])
  //   })
  //   .then((res) => {
  //     const [checkOk, local, remote] = res
  //     if (checkOk === false) {
  //       logger.warn(`Version mismatch, local: ${local}, remote: ${remote}`)
  //
  //       if (config.app.version.strictCheck) {
  //         logger.error('Strict version check enabled, exiting.')
  //         return
  //       }
  //     }
  //
  //     // Parse command line
  //     return program.parse(args)
  //   })
  //   .catch((err) => {
  //     logger.warn(`Unable to get git version, reason: ${err.message}`)
  //
  //     if (config.app.version.strictCheck) {
  //       // logger.error('Strict version check enabled, exiting.')
  //       // return
  //     }
  //
  //     // Parse command line
  //     return program.parse(args)
  //   })
};

const initDirs = () => {
  // Debug directory
  ensureDebugDir(true);

  // Log directory
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR);
  }
};

const initErrorHandlers = (logger, errorHandlers = {}) => {
  // Get all error handler names - uncaughtException, unhandledRejection ...
  const errorNames = Object.keys(errorHandlers);

  // Iterate ...
  errorNames.forEach(errorName => {
    debug(`Initializing ${errorName} handler`);
    const handlers = errorHandlers[errorName].map(handler => {
      // Initialize handler if init() func is specified
      handler.init && handler.init();

      return handler.handle;
    });

    process.on(errorName, err => {
      // eslint-disable-next-line no-console
      console.trace(err);
      handlers.forEach(handler => handler(errorName, err));
    });
  });
};

if (require.main === module) {
  main(process.argv);
}