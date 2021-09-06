'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});


const { inspect } = require('util'); /**
                                      * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
                                      *
                                      * This source code is licensed under the MIT license found in the
                                      * LICENSE file in the root directory of this source tree.
                                      *
                                      * 
                                      */

const { Command } = require('commander');

const { MINER_KEY_REGEX } = require('../minerKey');
const { getLogger } = require('../../logger');
const { Engine } = require('../../engine');
const { parseBoolean } = require('../../utils/config');

const ROVERS = Object.keys(require('../../rover/manager').rovers);
const BC_SUPER_COLLIDER = process.env.BC_SUPER_COLLIDER ? process.env.BC_SUPER_COLLIDER.toLowerCase() : 'bc';
const BC_NO_ROVERS = parseBoolean(process.env.BC_NO_ROVERS);

const gracefulShutdown = (engine, logger, exitType) => {
  logger.info('shutting down following %s', exitType);
  setTimeout(() => {
    process.exit();
  }, 5000);

  engine.requestExit().then(() => {
    process.exit();
  }).catch(e => {
    logger.debug(e);
    logger.error('error in engine.requestExit(), reason: %s', e.message);
    process.exit(-1);
  });
};

const initSignalHandler = (logger, engine) => {
  process.on('SIGINT', () => {
    gracefulShutdown(engine, logger, 'SIGINT');
  });
  process.on('SIGTERM', () => {
    gracefulShutdown(engine, logger, 'SIGTERM');
  });
  process.on('uncaughtException', e => {
    logger.debug('uncaughtException = %o', e);
    gracefulShutdown(engine, logger, 'SIGTERM');
  });
};

const cmd = exports.cmd = async program => {
  let {
    node,
    rovers = false,
    rpc,
    ui,
    ws,
    overline,
    fix,
    relayMode,
    scookie
  } = program.opts();

  // Initialize JS logger
  const logger = getLogger(__filename);

  let bcEnv = [];
  for (let key in process.env) {
    if (key.startsWith('BC') || key === 'MIN_HEALTH_NET' || key === 'DISABLE_IPH_TEST' || key === 'NODE_OPTIONS') {
      bcEnv.push(`${key}=${process.env[key]}`);
    }
  }

  logger.info(`starting engine...`);
  if (bcEnv.length !== 0) {
    logger.info(`bcEnv applied ->\n${bcEnv.sort().join('\n')}`);
  }

  logger.info(`rover list ${inspect(rovers)}`);

  let minerKey = process.env.BC_MINER_KEY || program.opts().minerKey;
  // If starting rovers we need to check miner key at first
  if (rovers && !relayMode) {
    if (!minerKey) {
      logger.error('--miner-key required');
      process.exit(-1);
    }

    if (!MINER_KEY_REGEX.test(minerKey)) {
      logger.error('miner key is malformed');
      process.exit(-2);
    }

    minerKey = minerKey.toLowerCase();
  }

  const opts = {
    rovers: ROVERS,
    overline,
    fix,
    minerKey,
    relayMode

    // Create engine instance
  };const engine = new Engine(opts);

  // Initialize engine
  try {
    await engine.init();
    // Initialize SIGING handler
    initSignalHandler(logger, engine);
  } catch (e) {
    logger.error(`failed to initialize protocol, reason: ${e.message}`);
    return -1;
  }

  if (node) {
    engine.startNode().then(() => {
      logger.info('local node startup complete -> Overline protocol initializing...');
    });
  }

  // Should the FIX protocol be available?
  if (fix) {
    engine.startFix().then(() => {
      // ROVER DEVELOPMENT TEAM PROGRAM: FIX
      // <--- LAUNCH KEY-CODE START ---> //
      // <--- LAUNCH KEY-CODE END ---> //
    });
  }

  // Should the Server be started?
  if (rpc || ui || ws) {
    await engine.startServer({
      rpc, // Enable RPC - /rpc
      ui, // Enable UI - /
      ws, // Enable WS - /ws
      rpcSecureCookie: scookie
    });
  }

  // Should the Rover be started?
  if (rovers) {
    const roversToStart = rovers === true ? ROVERS : rovers.split(',').map(roverName => roverName.trim().toLowerCase());

    // TODO: Move somewhere else
    const BC_ROVER_REPLAY = process.env.BC_ROVER_REPLAY;
    if (BC_ROVER_REPLAY === 'true' || BC_ROVER_REPLAY === '1') {
      engine.rovers.replay();
    }

    const latestBlock = await engine.persistence.get(`${BC_SUPER_COLLIDER}.block.latest`);
    let forceResync = true;
    if (latestBlock && parseInt(latestBlock.getHeight(), 10) > 2) {
      forceResync = true;
    }
    if (!BC_NO_ROVERS) {
      engine.startRovers(roversToStart, true).then(() => logger.info('rovers successfully deployed to network %s', roversToStart));
    }
  }

  // Should we enable Overline?
  if (overline) {
    engine.startOverline().then(() => {
      // ROVER DEVELOPMENT TEAM: OVERLINE
      // <--- LAUNCH KEY-CODE START ---> //
      // <--- LAUNCH KEY-CODE END ---> //
    });
  }

  // TODO: Wait for engine finish
  // engine.wait()
};