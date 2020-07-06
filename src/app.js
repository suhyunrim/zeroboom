const express = require('express');
const loader = require('./loaders');
const { logger } = require('./loaders/logger');

const startServer = async () => {
  const app = express();

  await loader(app);
};

startServer();
