'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.objFromFileSync = objFromFileSync;
exports.objToFile = objToFile;
exports.objToFileSync = objToFileSync;
/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const fs = require('fs');

/**
 * Synchronously loads object from file using JSON deserialization
 * @param path Path to file
 * @return {any} Deserialized object
 */
function objFromFileSync(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

/**
 * Saves object to file as pretty formatted JSON
 * @param path Path to file to store serialized object
 * @param obj Object to be serialized
 * @param replacer Replacer used for transformation
 * @param space Space settings for prettyfication
 */
function objToFile(path, obj, replacer = null, space = 2) {
  const json = JSON.stringify(obj, replacer, space);
  fs.writeFile(path, json, () => {});
}

/**
 * Synchronously saves object to file as pretty formatted JSON
 * @param path Path to file to store serialized object
 * @param obj Object to be serialized
 * @param replacer Replacer used for transformation
 * @param space Space settings for prettyfication
 */
function objToFileSync(path, obj, replacer = null, space = 2) {
  const json = JSON.stringify(obj, replacer, space);
  fs.writeFileSync(path, json, () => {});
}