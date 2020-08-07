const express = require('express');
const bodyParser = require('body-parser');
const loader = require('./loaders');
const { port } = require('./config');
const { logger } = require('./loaders/logger');
const path = require('path');

const indexRouter = require('./routes/index');
const userRouter = require('./routes/user');
const friendlyGameRouter = require('./routes/friendly-game');

const startServer = async () => {
  const app = express();
  app.use(bodyParser.urlencoded({ extended: false }));

  app.use(express.static(path.join(__dirname, '/../public')));
  app.set('views', path.join(__dirname, '/../views'));
  app.set('view engine', 'ejs');
  app.engine('html', require('ejs').renderFile);

  app.use('/', indexRouter);
  app.use('/user', userRouter);
  app.use('/friendly-game', friendlyGameRouter);

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
