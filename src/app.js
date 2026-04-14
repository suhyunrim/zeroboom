const express = require('express');
const moment = require('moment');
const bodyParser = require('body-parser');
const loader = require('./loaders');
const sentryLoader = require('./loaders/sentry');
const { port } = require('./config');
const { logger } = require('./loaders/logger');
const path = require('path');

const indexRouter = require('./routes/index');
const userRouter = require('./routes/user');

const riotMatchController = require('./controller/riot-match');

const startServer = async () => {
  const app = express();

  // Sentry 요청 핸들러를 가장 먼저 등록
  sentryLoader(app);

  app.use(bodyParser.urlencoded({ extended: false }));

  app.use(express.static(path.join(__dirname, '/../public')));
  app.set('views', path.join(__dirname, '/../views'));
  app.set('view engine', 'ejs');
  app.engine('html', require('ejs').renderFile);

  app.use('/', indexRouter);
  app.use('/user', userRouter);

  const server = await loader(app);

  server.listen(port, (err) => {
    if (err) {
      logger.error(err);
      process.exit(1);
    }
    logger.info(`
      ################################################
      Hello, ZeroBoom! Server listening on port: ${port}
      ################################################
    `);
  });
};

startServer();

// 처리되지 않은 예외를 Sentry로 전송
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
});

const retrieveRiotMatches = async () => {
  const targetDate = moment.utc().subtract(30, 'days');
  await riotMatchController.retrieveMatches('롤리데이', targetDate);
  setTimeout(retrieveRiotMatches, 1000 * 60 * 60 * 24);
};

//retrieveRiotMatches();
