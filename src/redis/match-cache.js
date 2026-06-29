const { client, isReady } = require('./redis');
const { logger } = require('../loaders/logger');

// 매칭생성 플랜/컨셉 데이터 캐시.
// 1차 = 인메모리 Map(빠르고 Redis 장애에도 동작), 백스토어 = Redis(재시작 생존).
// Map miss 시 Redis에서 복원(rehydrate)하므로, 봇 재시작 후에도 플랜 버튼이 살아있다.
const TTL_SECONDS = 24 * 60 * 60; // 24시간

const matchMap = new Map();
const conceptMap = new Map();

async function redisSet(key, value) {
  if (!isReady()) return;
  try {
    await client.set(key, JSON.stringify(value), { EX: TTL_SECONDS });
  } catch (e) {
    logger.warn(`매치캐시 Redis set 실패(${key}): ${e.message}`);
  }
}

async function redisGet(key) {
  if (!isReady()) return null;
  try {
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    logger.warn(`매치캐시 Redis get 실패(${key}): ${e.message}`);
    return null;
  }
}

async function setMatch(key, value) {
  matchMap.set(key, value);
  await redisSet(`match:${key}`, value);
}

// 못 찾으면 undefined 반환 (기존 Map.get 시맨틱 유지 — 호출부의 `if (match)` 체크 그대로)
async function getMatch(key) {
  if (matchMap.has(key)) return matchMap.get(key);
  const value = await redisGet(`match:${key}`);
  if (value != null) {
    matchMap.set(key, value);
    return value;
  }
  return undefined;
}

async function setConcept(key, value) {
  conceptMap.set(key, value);
  await redisSet(`concept:${key}`, value);
}

async function getConcept(key) {
  if (conceptMap.has(key)) return conceptMap.get(key);
  const value = await redisGet(`concept:${key}`);
  if (value != null) {
    conceptMap.set(key, value);
    return value;
  }
  return undefined;
}

module.exports = { setMatch, getMatch, setConcept, getConcept };
