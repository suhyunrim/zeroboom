const express = require('express');
const bodyParser = require('body-parser');
const loader = require('./loaders');
const { port } = require('./config');
const { logger } = require('./loaders/logger');

const startServer = async () => {
  const app = express();
  app.use(bodyParser.urlencoded({extended: false}));

  const server = await loader(app);

  server.listen(port, (err) => {
    if (err) {
      logger.error(err);
      process.exit(1);
    }
    logger.info(`
      ################################################
      Hello, Camille! Server listening on port: ${port}
      ################################################
    `);
  });
};

startServer();
