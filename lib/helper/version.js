'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.writeVersionFile = writeVersionFile;
/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const execSync = require('child_process').execSync;
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const request = promisify(require('request'));
const { pathOr } = require('ramda');

const { objFromFileSync, objToFileSync } = require('../helper/json');
const { config } = require('../config');

const logging = require('../logger');
const logger = logging.getLogger(__filename);

const PKG = require('../../package.json');

const VERSION_FILENAME = '.version.json';
const VERSION_FILE_PATH = path.resolve(__dirname, '..', '..', VERSION_FILENAME);

const GIT_PACKAGE_JSON_URL = 'https://raw.githubusercontent.com/blockcollider/bcnode/release/package.json';

const DEFAULT_VERSION = {
  git: { long: '<unknown>', short: '<unknown>' },
  npm: '<unknown>'

  /**
   * Generate version object
   * @returns {Object} Object repesenting version
   */
};const generateVersion = exports.generateVersion = () => {
  const cmds = [['npm', () => PKG.version], ['git', () => {
    return {
      long: execSync('git rev-parse HEAD').toString().trim(),
      short: execSync('git rev-parse --short HEAD').toString().trim()
    };
  }]];

  try {
    return cmds.reduce((acc, el) => {
      const [key, valFn] = el;

      try {
        acc[key] = valFn();
      } catch (e) {
        // lets keep the value from DEFAULT_VERSION
      }

      return acc;
    }, DEFAULT_VERSION);
  } catch (e) {
    logger.warn(`Unable to generate '${VERSION_FILENAME}', reason: ${e.message}`);
    return DEFAULT_VERSION;
  }
};

/**
 * Get version object
 *
 * @param path
 * @return {Object}
 */
const getVersion = exports.getVersion = (path = VERSION_FILE_PATH) => {
  if (fs.existsSync(path)) {
    try {
      return readVersionFile(path);
    } catch (e) {
      logger.warn(`Unable to read version from file, path: '${VERSION_FILENAME}', reason: ${e.message}`);
      return DEFAULT_VERSION;
    }
  }

  const version = generateVersion();
  if (version) {
    writeVersionFile(path, version);
  }

  return generateVersionFile(path);
};

/**
 * Get version object
 *
 * @param path
 * @return {Object}
 */
const generateVersionFile = exports.generateVersionFile = (path = VERSION_FILE_PATH) => {
  const version = generateVersion();
  if (version) {
    writeVersionFile(path, version);
  }

  return version;
};

/**
 * Read version object from file
 * @param path
 */
const readVersionFile = exports.readVersionFile = (path = VERSION_FILE_PATH) => {
  return objFromFileSync(path);
};

/**
 * Write version object to file
 *
 * @param path
 * @param version
 */
function writeVersionFile(path = VERSION_FILE_PATH, version = null) {
  // $FlowFixMe
  return objToFileSync(VERSION_FILE_PATH, version || getVersion(path));
}

const getRemoteVersion = exports.getRemoteVersion = () => {
  const url = pathOr(GIT_PACKAGE_JSON_URL, ['bc', 'version', 'url'], config);
  return request(url).then(response => {
    const obj = JSON.parse(response.body);
    return obj.version;
  });
};