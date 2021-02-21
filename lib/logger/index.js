'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }

const { resolve, sep } = require('path'); /**
                                           * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
                                           *
                                           * This source code is licensed under the MIT license found in the
                                           * LICENSE file in the root directory of this source tree.
                                           *
                                           * 
                                           */

const winston = require('winston');
const { config, format, addColors } = winston;
const { combine, timestamp, label, printf } = format;
const { is, merge } = require('ramda');
require('winston-daily-rotate-file');

const LOG_DIR = resolve(__dirname, '..', '..', '_logs');
const logPath = `${LOG_DIR}/bcnode`;
const logPathDate = `${LOG_DIR}/bcnode-%DATE%.log`;
const tsFormat = () => Math.floor(Date.now() * 0.001);

const colorMapping = {
  emerg: ['red'],
  alert: ['green'],
  crit: ['yellow'],
  error: ['red'],
  warning: ['yellow'],
  notice: ['magenta', 'dim'],
  info: ['green'],
  debug: ['cyan', 'dim']
};

const LOG_LEVEL = process.env.BC_LOG || 'info';
const formatColorTemplate = options => {
  const ts = options.timestamp ? `${options.timestamp()} ` : '';
  const level = !!process.stdout.isTTY ? config.colorize(options.level, options.level.toUpperCase()) : options.level.toUpperCase();
  const msg = undefined !== options.message ? options.message : '';
  const meta = options.meta && Object.keys(options.meta).length ? '\n\t' + JSON.stringify(options.meta, null, 2) : '';

  return `OVERLINE ${ts}${level}\t${msg} ${meta}`;
};

const formatTemplate = options => {
  const ts = options.timestamp ? `${options.timestamp()} ` : '';
  const level = options.level.toUpperCase();
  const msg = undefined !== options.message ? options.message : '';
  const meta = options.meta && Object.keys(options.meta).length ? '\n\t' + JSON.stringify(options.meta, null, 2) : '';

  return `${ts}${level}\t${msg} ${meta}`;
};

const customFormat = printf(({ level, message, label, timestamp }) => {
  return `${timestamp} ${level.toUpperCase()} ${message}`;
});

const logger = new winston.createLogger({
  transports: [
  // Console
  new winston.transports.Console({
    level: LOG_LEVEL,
    timestamp: tsFormat,
    humanReadableUnhandledException: true,
    json: false,
    colorize: true,
    format: combine(format.colorize(), format.timestamp({ format: 'YYYYMMDD HH:mm:ss' }), format.align(), format.simple(), format.printf(info => {
      const {
        timestamp, level, message } = info,
            args = _objectWithoutProperties(info, ['timestamp', 'level', 'message']);
      const ts = timestamp;
      return `OVERLINE ${ts} ${level}${message}${Object.keys(args).length && Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : ''}`;
    }))
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
    format: combine(format.timestamp({ format: 'YYMMDD HH:mm:ss' }), format.align(), format.simple(), format.printf(info => {
      const {
        timestamp, level, message } = info,
            args = _objectWithoutProperties(info, ['timestamp', 'level', 'message']);
      const ts = timestamp;
      return `${ts} ${level}${message} ${Object.keys(args).length && Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : ''}`;
    }))
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

const pathToLogPrefix = (path, topLevelDir = 'lib') => {
  const parts = path.split(sep);
  const sliceAt = parts.indexOf(topLevelDir);
  return parts.slice(sliceAt + 1, parts.length).join('.').replace(/^\.|\.js$/g, '').toLowerCase();
};

class LoggingContext {
  /* eslint-enable */
  constructor(logger, prefix, metadata) {
    this._parent = logger;

    // Trim '.' on start or end of the prefix
    this._prefix = prefix ? prefix.replace(/^\.|\.$/g, '') + ' ' : '';
    this._metadata = metadata || {};

    // Generate convenience log methods based on what the parent has
    if (this._parent && this._parent.levels && is(Object, this._parent.levels)) {
      Object.keys(this._parent.levels).forEach(level => {
        // $FlowFixMe TODO fix in better way
        this[level] = function () {
          // build argument list (level, msg, ... [string interpolate], [{metadata}], [callback])
          const args = [level].concat(Array.prototype.slice.call(arguments));
          this.log.apply(this, args);
        };
      });
    }
  }
  /* eslint-disable no-undef */


  close(id) {
    return this._parent.close(id);
  }

  log(level, name) {
    // Stolen procesing code from Winston itself
    const args = Array.prototype.slice.call(arguments, 2); // All args except level and name

    const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    let meta = {};
    const nonMeta = [];

    for (let i = 0; i < args.length; i += 1) {
      if (is(Object, args[i])) {
        meta = merge(meta, args[i]);
      } else {
        nonMeta.push(args[i]);
      }
    }

    this._parent.log.apply(this._parent, [level, this._prefix + name].concat(nonMeta).concat([merge(meta, this._metadata), callback]));
  }
}

addColors(colorMapping);

function expandErrors(logger) {
  var oldLogFunc = logger.log;
  // $FlowFixMe: here we purposedly monkey patch winston logger func
  logger.log = function () {
    var args = Array.prototype.slice.call(arguments, 0);
    if (args.length >= 2 && args[1] instanceof Error) {
      args[1] = args[1].stack;
    }
    return oldLogFunc.apply(this, args);
  };
  return logger;
}

const getLogger = exports.getLogger = (path, translatePath = true, meta) => {
  const name = translatePath ? pathToLogPrefix(path) : path;
  return expandErrors(new LoggingContext(logger, name, meta));
};