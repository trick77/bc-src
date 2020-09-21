'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _client = require('./client');

Object.defineProperty(exports, 'RpcClient', {
  enumerable: true,
  get: function () {
    return _interopRequireDefault(_client).default;
  }
});

var _server = require('./server');

Object.defineProperty(exports, 'RpcServer', {
  enumerable: true,
  get: function () {
    return _interopRequireDefault(_server).default;
  }
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }