const express = require('express');
const moment = require('moment');
const bodyParser = require('body-parser');
const loader = require('./loaders');
const { port } = require('./config');
const { logger } = require('./loaders/logger');
const path = require('path');

const indexRouter = require('./routes/index');
const userRouter = require('./routes/user');
const friendlyGameRouter = require('./routes/friendly-game');
const matchHistoryRouter = require('./routes/match-history');

const riotMatchController = require('./controller/riot-match');

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
  app.use('/match-history', matchHistoryRouter);

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

const retrieveRiotMatches = async () => {
  const targetDate = moment.utc().subtract(30, 'days');
  await riotMatchController.retrieveMatches('롤리데이', targetDate);
  setTimeout(retrieveRiotMatches, 1000 * 60 * 60 * 24);
};

//retrieveRiotMatches();
