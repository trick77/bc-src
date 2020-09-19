'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.errToObj = errToObj;
exports.errToString = errToString;
/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */

const { inspect } = require('util');

/**
 * Converts error to object which can be serialized to JSON
 *
 * {
 *   "stack": [
 *     "Error: Could not deserialize value",
 *      "at db.get (/Users/korczis/dev/bcnode/lib/persistence/rocksdb.js:106:25)"
 *   ],
 *   "message": "Could not deserialize value"
 * }
 *
 * @param err Error to be converted
 * @return {{}}
 */
function errToObj(err) {
  const props = Object.getOwnPropertyNames(err);

  const obj = props.reduce((acc, val) => {
    // $FlowFixMe
    acc[val] = err[val];
    return acc;
  }, {});

  // $FlowFixMe
  obj.stack = (obj.stack || '').split('\n').map(line => line.trim()).filter(line => line !== '');

  return obj;
}

/**
 * Safely serializes Error to string through Object (created by `errToObj`)
 *
 * @param {Error} err Error to be serialized
 * @return {String} serialized error
 */
function errToString(err) {
  const obj = errToObj(err);

  return inspect(obj);
}