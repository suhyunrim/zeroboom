const { createClient } = require('redis');
const { logger } = require('../loaders/logger');

// node-redis v4 클라이언트. Redis는 best-effort 캐시로만 사용하며, 연결 실패/장애 시에도
// 봇 기능이 죽지 않도록 호출부는 반드시 isReady() 가드 + try/catch로 감싼다.
let ready = false;
let loggedError = false;

const client = createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    // 무한 재연결(백오프). 캐시라 끊겨도 봇은 인메모리로 계속 동작한다.
    reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
  },
  password: process.env.REDIS_PASS || undefined,
  database: Number(process.env.REDIS_DB) || 0,
});

client.on('ready', () => {
  ready = true;
  loggedError = false;
  logger.info('Redis 연결됨');
});
client.on('end', () => {
  ready = false;
});
client.on('error', (err) => {
  ready = false;
  // 연결 실패 시 error 이벤트가 반복 발생하므로 최초 1회만 로깅(스팸 방지)
  if (!loggedError) {
    loggedError = true;
    logger.warn(`Redis 오류(인메모리 폴백): ${err.message}`);
  }
});

// 부팅 시 1회 호출. REDIS_HOST 미설정이면 연결을 시도하지 않는다(로컬/비활성 환경).
async function connect() {
  if (!process.env.REDIS_HOST) {
    logger.info('REDIS_HOST 미설정 — Redis 비활성(인메모리 캐시만 사용)');
    return;
  }
  try {
    await client.connect();
  } catch (e) {
    // 초기 연결 실패해도 reconnectStrategy로 백그라운드 재시도. 봇은 계속 동작.
    logger.warn(`Redis 연결 실패(인메모리 폴백): ${e.message}`);
  }
}

// 연결될 때까지 대기(최대 timeoutMs). REDIS_HOST 미설정이면 즉시 반환.
// 부팅 복원처럼 "연결돼 있으면 쓰고 싶다"는 호출부용 — 시간 내 못 붙어도 예외 없이 반환한다(best-effort 원칙).
async function waitUntilReady(timeoutMs) {
  if (!process.env.REDIS_HOST || ready) return;
  await new Promise((resolve) => {
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      client.off('ready', onReady);
      resolve();
    }, timeoutMs);
    client.once('ready', onReady);
  });
}

module.exports = { client, connect, waitUntilReady, isReady: () => ready };
