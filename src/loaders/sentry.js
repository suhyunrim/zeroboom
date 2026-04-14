const Sentry = require('@sentry/node');
const config = require('../config');

module.exports = (app) => {
  if (!config.sentry.dsn) return;

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: process.env.NODE_ENV || 'development',
    integrations: [
      Sentry.expressIntegration(),
    ],
  });

  // 요청 핸들러 — 모든 라우트보다 먼저 등록
  app.use(Sentry.Handlers.requestHandler());
};
