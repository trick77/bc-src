'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getLogger = exports._pathToLogPrefix = undefined;

var _findUp = require('find-up');

var _findUp2 = _interopRequireDefault(_findUp);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }

const { resolve, sep, dirname } = require('path'); /**
                                                    * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
                                                    *
                                                    * This source code is licensed under the MIT license found in the
                                                    * LICENSE file in the root directory of this source tree.
                                                    *
                                                    * 
                                                    */

const { is, merge } = require('ramda');
const winston = require('winston');
require('winston-daily-rotate-file');

const { config, format, addColors } = winston;

const LOG_DIR = resolve(__dirname, '..', '..', '_logs');
const logPath = `${LOG_DIR}/bcnode`;
const logPathDate = `${LOG_DIR}/bcnode-%DATE%.log`;
const tsFormat = () => Math.floor(Date.now() * 0.001);

const colorMapping = {
  error: ['red'],
  warn: ['yellow'],
  info: ['green'],
  debug: ['cyan', 'dim'],
  silly: ['grey', 'dim']
};

const LOG_LEVEL = process.env.BC_LOG || 'info';

const getFormats = function (colorized, prefixedWithOverline) {
  const prefix = prefixedWithOverline ? 'OVERLINE ' : '';
  const formats = [format.timestamp({ format: 'YYYYMMDD HH:mm:ss' }), format.align(), format.simple(), format.splat(), format.printf(info => {
    const {
      timestamp, level, message, label } = info,
          args = _objectWithoutProperties(info, ['timestamp', 'level', 'message', 'label']);
    return `${prefix}${timestamp} ${level} ${label} ${message}${Object.keys(args).length && Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : ''}`;
  })];

  if (colorized) {
    formats.unshift(format.colorize());
  }

  return format.combine(...formats);
};

const logger = new winston.createLogger({
  transports: [
  // Console
  new winston.transports.Console({
    level: LOG_LEVEL,
    humanReadableUnhandledException: true,
    format: getFormats(process.stdout.isTTY, true)
  }),

  // File
  new winston.transports.DailyRotateFile({
    filename: logPathDate,
    datePattern: 'YYYY-MM-DD-HH',
    json: false,
    zippedArchive: true,
    level: LOG_LEVEL,
    maxSize: '20m',
    maxFiles: '29d',
    format: getFormats(false, false)
  })],
  exceptionHandlers: [new winston.transports.File({
    filename: `${logPath}-exceptions.log`,
    json: false,
    formatter: options => {
      const msg = {
        msg: options.message,
        date: options.meta.date,
        stack: options.meta.stack
      };
      return JSON.stringify(msg, null, 2);
    }
  })],
  exitOnError: false
});

const pkgDir = dirname(_findUp2.default.sync('package.json'));
const _pathToLogPrefix = exports._pathToLogPrefix = path => {
  let moduleSuffix = path;
  for (let prefixDir of ['lib', 'src']) {
    moduleSuffix = moduleSuffix.replace(`${pkgDir}${sep}${prefixDir}`, '');
  }
  return moduleSuffix.split(sep).join('.').replace(/^\.|\.js$/g, '').toLowerCase();
};

addColors(colorMapping);

const getLogger = exports.getLogger = (path, translatePath = true, meta) => {
  const name = translatePath ? _pathToLogPrefix(path) : path;
  return logger.child({ label: name });
};