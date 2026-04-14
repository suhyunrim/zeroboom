const Sentry = require('@sentry/node');
const config = require('../config');

module.exports = () => {
  if (!config.sentry.dsn) return;

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: process.env.NODE_ENV || 'development',
    integrations: [
      Sentry.expressIntegration(),
    ],
  });
};
