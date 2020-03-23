'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _minerNative = require('./minerNative');

Object.defineProperty(exports, 'MinerNative', {
  enumerable: true,
  get: function () {
    return _interopRequireDefault(_minerNative).default;
  }
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }