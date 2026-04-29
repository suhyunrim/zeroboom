const bodyParser = require('body-parser');
const cors = require('cors');
const methodOverride = require('method-override');
const Sentry = require('@sentry/node');

const { logMiddleWare } = require('./logger');
const routes = require('../api');
const config = require('../config');

module.exports = (app) => {
  app.use(logMiddleWare);
  app.get('/status', (req, res) => {
    res.status(200).end();
  });
  app.head('/status', (req, res) => {
    res.status(200).end();
  });
  app.enable('trust proxy');
  app.use(cors());
  app.use(methodOverride());
  app.use(bodyParser.json());
  app.use(config.api.prefix, routes());

  // 라우트 중복 등록 감지 — 같은 method+path가 두 군데서 등록되면 throw.
  // (예: 다른 파일에서 같은 mount prefix에 동일 path를 등록한 경우)
  const seen = new Set();
  const getMount = (layer) => {
    if (layer.regexp.fast_slash) return '';
    const m = layer.regexp.source.match(/^\^(.+?)\\\/\?\(\?=\\\/\|\$\)$/);
    return m ? m[1].replace(/\\\//g, '/') : '';
  };
  const walk = (stack, prefix) => {
    stack.forEach((layer) => {
      if (layer.route) {
        Object.keys(layer.route.methods).forEach((method) => {
          const key = `${method.toUpperCase()} ${prefix}${layer.route.path}`;
          if (seen.has(key)) throw new Error(`라우트 중복 등록 감지: ${key}`);
          seen.add(key);
        });
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        walk(layer.handle.stack, prefix + getMount(layer));
      }
    });
  };
  walk(app._router.stack, ''); // eslint-disable-line no-underscore-dangle

  // Sentry 에러 핸들러 — 다른 에러 핸들러보다 먼저 등록
  if (config.sentry.dsn) {
    Sentry.setupExpressErrorHandler(app);
  }

  app.use((req, res, next) => {
    const err = new Error('Not Found');
    err.status = 404;
    next(err);
  });
  app.use((err, req, res, next) => {
    if (err.name === 'UnauthorizedError') {
      return res
        .status(err.status)
        .send({ message: err.message })
        .end();
    }
    return next(err);
  });
  app.use((err, req, res, next) => {
    res.status(err.status || 500);
    res.json({
      errors: {
        message: err.message,
      },
    });
  });
};
