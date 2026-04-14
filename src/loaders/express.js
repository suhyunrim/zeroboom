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
