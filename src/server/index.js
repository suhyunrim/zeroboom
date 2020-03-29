import express from 'express';
import loader from './loaders';
import { port } from './config';
import { logger } from './loaders/logger';

async function startServer() {
  const app = express();
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
}

startServer();
