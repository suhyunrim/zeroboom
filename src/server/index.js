const express = require('express');
// const config = require('./config');
const logger = require('./loaders/logger');

async function startServer() {
  const app = express();

  app.listen(3000, err => {
    if (err) {
      logger.error(err);
      process.exit(1);
      return;
    }
    logger.info(`
      ################################################
      Hello, Camille! Server listening on port: ${3000}
      ################################################
    `);
  });
}

startServer();
