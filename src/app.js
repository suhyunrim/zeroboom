const express = require('express');
const bodyParser = require('body-parser');
const loader = require('./loaders');
const sentryLoader = require('./loaders/sentry');
const { port } = require('./config');
const { logger } = require('./loaders/logger');
const path = require('path');

const indexRouter = require('./routes/index');
const userRouter = require('./routes/user');

const startServer = async () => {
  const app = express();

  // Sentry 초기화
  sentryLoader();

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

startServer().catch((err) => {
  // 부팅 중(DB 연결 등) 실패 시 조용히 멈추지 않고 프로세스를 종료해 재배포/재시작이 트리거되도록 함
  logger.error('서버 시작 실패:', err);
  process.exit(1);
});

// 처리되지 않은 예외를 Sentry로 전송
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
});
