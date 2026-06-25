// Set the NODE_ENV to 'development' by default
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const envFound = require('dotenv').config();

if (!envFound) {
  throw new Error("⚠️  Couldn't find .env file  ⚠️");
}

module.exports = {
  port: parseInt(process.env.SERVICE_PORT, 10),
  jwtSecret: process.env.JWT_SECRET,
  logs: {
    level: process.env.LOG_LEVEL || 'silly',
  },
  database: {
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASS,
    database: process.env.DATABASE_NAME,
    host: process.env.DATABASE_HOST || 'localhost',
    port: process.env.DATABASE_PORT || 3306,
    dialect: 'mysql',
    operatorsAliases: 0,
  },
  discord: {
    clientId: process.env.DISCORD_APPLICATION_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectUri: process.env.DISCORD_REDIRECT_URI,
  },
  frontendUrl: process.env.FRONTEND_URL,
  pickCount: (() => {
    const raw = Number(process.env.PICK_COUNT) || 10;
    if (raw % 2 !== 0) {
      console.warn(`[config] PICK_COUNT=${raw}는 홀수입니다. ${raw + 1}로 보정합니다.`);
      return raw + 1;
    }
    return raw;
  })(),
  sentry: {
    dsn: process.env.SENTRY_DSN || '',
  },
  ai: {
    // 프로바이더 격리: 현재 anthropic 고정. 키 없으면 AI 기능만 비활성(앱은 정상 동작).
    provider: process.env.AI_PROVIDER || 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-haiku-4-5',
    maxRounds: Number(process.env.AI_MAX_ROUNDS) || 5,
  },
  api: {
    prefix: '/api',
  },
};
