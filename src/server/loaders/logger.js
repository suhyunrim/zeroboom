import winston from 'winston';
import morgan from 'morgan';
import chalk from 'chalk';
import moment from 'moment';
import fs from 'fs';

import config from '../config';

const logDir = `${__dirname}/../../logs`;

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const errorStackFormat = winston.format((info) => {
  if (info instanceof Error) {
    return { ...info, message: info.stack };
  }
  return info;
});

const infoTransport = new winston.transports.File({
  filename: `${moment().format('YYYY-MM-DD')}-info.log`,
  dirname: logDir,
  maxsize: 5242880, // 5MB
  maxFiles: 5,
  level: 'info',
  handleExceptions: true,
  json: false,
  colorize: true,
});

const errorTransport = new winston.transports.File({
  filename: `${moment().format('YYYY-MM-DD')}-error.log`,
  dirname: logDir,
  maxsize: 5242880, // 5MB
  maxFiles: 5,
  level: 'error',
  handleExceptions: true,
  json: false,
  colorize: true,
});

const consoleTransport = new winston.transports.Console({
  level: config.logs.level,
  handleExceptions: true,
  json: false,
  colorize: true,
});

const logger = winston.createLogger({
  format: winston.format.combine(
    errorStackFormat(),
    winston.format.timestamp(),
    winston.format.printf(({ message, level, timestamp }) => {
      const customTimestamp = chalk.magentaBright(
        moment(timestamp).format('YYYY-MM-DD HH:mm:ss.SSS'),
      );
      let levelColor = chalk.white;
      let messageColor = chalk.white;
      switch (level.toUpperCase()) {
        case 'INFO':
          levelColor = chalk.cyan;
          break;
        case 'WARN':
          levelColor = chalk.yellow;
          break;
        case 'ERROR':
          levelColor = chalk.red;
          break;
        case 'DEBUG':
          levelColor = chalk.redBright;
          messageColor = chalk.greenBright;
          break;
        case 'TRACE':
          levelColor = chalk.yellowBright;
          messageColor = chalk.greenBright;
          break;
        default:
          break;
      }
      // console.log(i);
      return `[${customTimestamp}][${levelColor(level)}] ${messageColor(
        message,
      )}`;
    }),
  ),
  transports: [infoTransport, errorTransport, consoleTransport],
});
const stream = { write: (message) => logger.info(message) };

const logMiddleWare = morgan(
  (tokens, req, res) =>
    [
      chalk.hex('#34ace0').bold(tokens.method(req, res)),
      chalk.hex('#ffb142').bold(tokens.status(req, res)),
      chalk.hex('#ff5252').bold(tokens.url(req, res)),
      chalk.hex('#2ed573').bold(`${tokens['response-time'](req, res)} ms`),
      chalk.yellow(tokens['remote-addr'](req, res)),
      chalk.hex('#1e90ff')(tokens['user-agent'](req, res)),
    ].join(' '),
  { stream },
);

export { logger, stream, logMiddleWare };
