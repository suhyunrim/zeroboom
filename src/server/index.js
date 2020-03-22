const app = require('express')();
const loader = require('./loaders');
const { port } = require('./config');
const logger = require('./loaders/logger');

async function startServer() {
  await loader(app);

  app.listen(port, err => {
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
}

startServer();
