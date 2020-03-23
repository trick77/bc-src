'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _rocksdb = require('./rocksdb');

Object.defineProperty(exports, 'RocksDb', {
  enumerable: true,
  get: function () {
    return _interopRequireDefault(_rocksdb).default;
  }
});

var _memorymap = require('./memorymap');

Object.defineProperty(exports, 'MemoryMap', {
  enumerable: true,
  get: function () {
    return _interopRequireDefault(_memorymap).default;
  }
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }