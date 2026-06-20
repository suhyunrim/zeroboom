const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const methodOverride = require('method-override');
const Sentry = require('@sentry/node');

const { logMiddleWare } = require('./logger');
const routes = require('../api');
const config = require('../config');
const { RENEWED_TOKEN_HEADER } = require('../api/middlewares/auth');

module.exports = (app) => {
  app.use(logMiddleWare);
  app.get('/status', (req, res) => {
    res.status(200).end();
  });
  app.head('/status', (req, res) => {
    res.status(200).end();
  });
  app.enable('trust proxy');
  // 프론트(graves.zeroboom.lol)와 API(zeroboom.lol)는 같은 site의 다른 서브도메인이라
  // cross-origin이다. 세션 쿠키를 cross-origin 요청에 실으려면 credentials 허용이 필요하고,
  // 이때 Allow-Origin은 와일드카드(*)가 불가하므로 요청 Origin을 반사한다.
  // (쿠키는 SameSite=Lax라 same-site인 zeroboom.lol 서브도메인에서만 전송된다)
  // X-Renewed-Token: 슬라이딩 만료로 재발급된 JWT를 프론트가 읽을 수 있도록 노출
  app.use(
    cors({
      origin: true,
      credentials: true,
      exposedHeaders: [RENEWED_TOKEN_HEADER],
    }),
  );
  app.use(cookieParser());
  app.use(methodOverride());
  app.use(bodyParser.json());
  app.use(config.api.prefix, routes());

  // 라우트 중복 등록 감지 — 같은 method+path가 두 군데서 등록되면 throw.
  // (예: 다른 파일에서 같은 mount prefix에 동일 path를 등록한 경우)
  const seen = new Set();
  const getMount = (layer) => {
    if (layer.regexp.fast_slash) return '';
    const m = layer.regexp.source.match(/^\^(.+?)\\\/\?\(\?=\\\/\|\$\)$/);
    return m ? m[1].replace(/\\\//g, '/') : '';
  };
  const walk = (stack, prefix) => {
    stack.forEach((layer) => {
      if (layer.route) {
        Object.keys(layer.route.methods).forEach((method) => {
          const key = `${method.toUpperCase()} ${prefix}${layer.route.path}`;
          if (seen.has(key)) throw new Error(`라우트 중복 등록 감지: ${key}`);
          seen.add(key);
        });
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        walk(layer.handle.stack, prefix + getMount(layer));
      }
    });
  };
  walk(app._router.stack, ''); // eslint-disable-line no-underscore-dangle

  // Sentry 에러 핸들러 — 다른 에러 핸들러보다 먼저 등록
  if (config.sentry.dsn) {
    Sentry.setupExpressErrorHandler(app);
  }

  app.use((req, res, next) => {
    const err = new Error('Not Found');
    err.status = 404;
    next(err);
  });
  app.use((err, req, res, next) => {
    if (err.name === 'UnauthorizedError') {
      return res
        .status(err.status)
        .send({ message: err.message })
        .end();
    }
    return next(err);
  });
  app.use((err, req, res, next) => {
    res.status(err.status || 500);
    res.json({
      errors: {
        message: err.message,
      },
    });
  });
};
