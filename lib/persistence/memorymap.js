'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});


const debug = require('debug')('bcnode:persistence:memorymap'); /*
                                                                 * Copyright (c) 2017-present, Block Collider developers, All rights reserved.
                                                                 *
                                                                 * This source code is licensed under the MIT license found in the
                                                                 * LICENSE file in the root directory of this source tree.
                                                                 *
                                                                 * 
                                                                 */

const MapObject = require('mmap-object');
const fs = require('fs');
const typeforce = require('typeforce');
const { getLogger } = require('../logger');

const BC_MAX_MEMORY_OBJ_BUCKETS = 2000000; // 1 million
const BC_MAX_MEMORY_OBJ_SIZE = 1500000; // 1GB

// enforce plain values or 1-dim arrays on values
const valueType = typeforce.compile(typeforce.anyOf('Number', 'String', 'Boolean', typeforce.arrayOf(typeforce.anyOf('Number', 'String', 'boolean'))));
const keyType = typeforce.compile(typeforce.anyOf('String', 'Number'));

const deserialize = val => {
  if (!val) return val;
  if (val[0] === ':') {
    return JSON.parse(val.slice(1, val.length));
  }
  return val;
};

const serialize = val => {
  if (!val) return val;
  if (Array.isArray(val)) {
    return `:${JSON.stringify(val)}`;
  }
  return val;
};

class MemoryMap {

  constructor(path, opts = {}) {
    const maxSize = opts.size ? opts.size : BC_MAX_MEMORY_OBJ_SIZE;
    const maxBuckets = opts.buckets ? opts.buckets : BC_MAX_MEMORY_OBJ_BUCKETS;

    this._logger = getLogger(__filename);
    this._path = path;
    this._writable = !!opts.writable;
    this._model = opts.model ? opts.model : false;
    //this._memory = opts.writable ? new MapObject.Create(path, maxSize, maxBuckets) : new MapObject.Open(path)
    this._logger.info(`path for object is: ${path}, max size: ${maxSize}, writable: ${this._writable}`);
    if (this._writable) {
      if (fs.existsSync(path)) {
        this._logger.info(`removing stale chainstate: ${path}`);
        fs.unlinkSync(path);
      }
      this._memory = new MapObject.Create(path, maxSize);
    } else {
      this._writable = false;
      this._memory = new MapObject.Open(path);
    }
    debug(`memory map initialized max size: ${maxSize / 1000000} max buckets: ${maxBuckets}`);
  }

  close(removeDiskData = false) {
    if (removeDiskData && !this._writable) {
      return Promise.reject(new Error('cannot close and remove disk data in read only mode'));
    }
    const tasks = [];
    const p = new Promise((resolve, reject) => {
      try {
        if (!this._memory) {
          resolve(true);
        } else if (this._memory.isClosed()) {
          resolve(true);
        } else {
          this._memory.close(err => {
            if (err) {
              reject(err);
            } else {
              resolve(true);
            }
          });
        }
      } catch (err) {
        reject(err);
      }
    });
    tasks.push(p);

    if (removeDiskData) {
      const c = new Promise((resolve, reject) => {
        // use next tick to ensure it does not conflict with alloc empty from mmmap
        process.nextTick(() => {
          fs.unlink(this._path, err => {
            if (err) {
              this._logger.error(err);
            }
            return resolve();
          });
        });
      });

      tasks.push(c);
    }
    return Promise.all(tasks);
  }

  putAsync(key, value) {
    return new Promise((resolve, reject) => {
      if (!this._writable) {
        return reject(new Error('memory map object instantiated in read only mode'));
      }
      try {
        this._memory[key] = value;
        resolve(value);
      } catch (err) {
        reject(err);
      }
    });
  }

  put(key, value) {
    if (!this._writable) {
      throw new Error('memory map object instantiated in read only mode');
    }
    if (!this._memory) return null;
    if (this._memory.isClosed()) {
      throw new Error('cannot write to closed memory map');
    }
    typeforce(valueType, value);
    typeforce(keyType, key);
    // Determine if the key is a reference to an array
    const pointer = `${key}:0`;
    if (this._memory[pointer]) {
      return this.push(key, value);
    }
    if (this._model) {
      if (key in this._model) {
        this._memory[key] = serialize(value);
      } else {
        throw new Error(`key not in model ${JSON.stringify(this._model)}`);
      }
    } else {
      this._memory[key] = serialize(value);
    }
  }

  length(key) {
    if (!this._memory) return null;
    if (this._memory.isClosed()) {
      throw new Error('cannot read from closed memory map');
    }
    // !!! IMPORTANT !!! check if key pointer is array before determining if key exists
    const pointer = `${key}:0`;
    if (this._memory[pointer]) {
      return this._memory[`${key}:length`];
    }
    if (!this._memory[key]) return null;
    return deserialize(this._memory[key]).length;
  }

  get(key) {
    if (!this._memory) return null;
    if (this._memory.isClosed()) {
      throw new Error('cannot read from closed memory map');
    }
    // !!! IMPORTANT !!! check if key pointer is array before determining if key exists
    const pointer = `${key}:0`;
    if (this._memory[pointer]) {
      return this.getArray(key);
    }

    if (this._memory[key]) {
      return deserialize(this._memory[key]);
    } else {
      return null;
    }
  }

  del(key) {
    if (!this._memory) return null;
    if (this._memory.isClosed()) {
      throw new Error('cannot delete from closed memory map');
    }
    if (!this._writable) {
      throw new Error('memory map object instantiated in read only mode');
    }
    // !!! IMPORTANT !!! check if key pointer is array before determining if key exists
    delete this._memory[key];
    return true;
  }

  getArray(key) {
    const pointer = `${key}:0`;
    const lengthPointer = `${key}:length`;
    if (!this._memory) return null;
    if (this._memory.isClosed()) {
      throw new Error('cannot read from closed memory map');
    }
    if (!this._memory[pointer]) return null;
    const length = this._memory[lengthPointer];
    const arr = [];
    let i = 0;
    while (i < length) {
      const val = deserialize(this._memory[`${key}:${i}`]);
      arr.push(val);
      i++;
    }
    return arr;
  }

  push(key, val) {
    if (!this._writable) {
      throw new Error('memory map object instantiated in read only mode');
    }
    if (!this._memory) return null;
    if (!val) return null;
    typeforce(valueType, val);
    const keyStr = typeof key === 'number' ? key.toString(10) : key;
    if (keyStr.indexOf(':') > -1) {
      throw new Error('illegal character ":" in key');
    }
    const pointer = `${key}:0`;
    const lengthPointer = `${key}:length`;
    if (this._memory.isClosed()) {
      throw new Error('cannot read from closed memory map');
    }
    if (!this._memory[pointer]) {
      // Array has not been created
      this._memory[pointer] = serialize(val);
      this._memory[lengthPointer] = 1;
    } else if (this._memory[lengthPointer]) {
      const index = this._memory[lengthPointer];
      const pointer = `${key}:${index}`;
      this._memory[lengthPointer] = index + 1;
      this._memory[pointer] = serialize(val);
    }
    return val;
  }

  pop(key) {
    if (!this._writable) {
      throw new Error('memory map object instantiated in read only mode');
    }
    if (!this._memory) return null;
    const lengthPointer = `${key}:length`;
    const length = this._memory[lengthPointer];
    if (!length) {
      return null;
    }
    const index = length - 1;
    const pointer = `${key}:${index}`;
    const val = deserialize(this._memory[pointer]);
    if (!val) {
      return null;
    }
    this._memory[lengthPointer] = index;
    return val;
  }

  slice(key, start, index) {
    if (!this._writable) {
      throw new Error('memory map object instantiated in read only mode');
    }
    if (!this._memory) return null;
    if (!key) {
      throw new Error('key not provided');
    }
    const keyStr = typeof key === 'number' ? key.toString(10) : key;
    if (keyStr.indexOf(':') > -1) {
      throw new Error('illegal character ":" in key');
    }
    if (!start) {
      throw new Error('start key not provided');
    }
    if (!index) {
      throw new Error('index key not provided');
    }
    const arr = [];
    let i = key + index;
    while (this._memory[`${key}:${i}`]) {
      const val = this._memory[`${key}:${i}`];
      arr.push(val);
    }
    return arr;
  }

  splice(key, start, index) {
    if (!this._writable) {
      throw new Error('memory map object instantiated in read only mode');
    }
    if (!this._memory) return null;
    if (!key) {
      throw new Error('key not provided');
    }
    const keyStr = typeof key === 'number' ? key.toString(10) : key;
    if (keyStr.indexOf(':') > -1) {
      throw new Error('illegal character ":" in key');
    }
    if (!start) {
      throw new Error('start key not provided');
    }
    if (!index) {
      throw new Error('index key not provided');
    }
    const arr = [];
    let i = key + index;
    while (this._memory[`${key}:${i}`]) {
      const val = this._memory[`${key}:${i}`];
      arr.push(val);
      delete this._memory[`${key}:${i}`];
    }
    return arr;
  }

  flush() {
    if (!this._writable) {
      throw new Error('unable to flush memory while instantiated in read only mode');
    }
    if (!this._memory) return null;
    if (this._memory.isClosed()) {
      throw new Error('unable to flush closed memory');
    }
    let i = 0;
    for (let key in this._memory) {
      i++;
      if (this._memory.isData(key)) {
        delete this._memory[key];
      }
    }
    debug(`${i} keys removed from memory object`);
    return true;
  }
}
exports.default = MemoryMap;