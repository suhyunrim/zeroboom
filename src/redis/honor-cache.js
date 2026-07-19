const { client, isReady } = require('./redis');
const { logger } = require('../loaders/logger');

// 명예(MVP) 투표 세션 백스토어.
// 세션이 12시간 살아 있어 배포/재시작과 겹치기 쉽고, 끊기면 그 판의 MVP 투표는 복구 불가다.
// 인메모리 Map(discord.js)이 1차이고, 여기엔 직렬화 가능한 최소 정보만 둔다:
// - 메시지는 산 객체 대신 {channelId, messageId} 참조
// - voters는 저장하지 않는다 (honor_votes 테이블이 정본 — 복원 시 DB에서 재구성)
const KEY_PREFIX = 'honorVote:';

async function saveSession(gameId, data, ttlSeconds) {
  if (!isReady() || ttlSeconds <= 0) return;
  try {
    await client.set(`${KEY_PREFIX}${gameId}`, JSON.stringify(data), { EX: Math.ceil(ttlSeconds) });
  } catch (e) {
    logger.warn(`명예투표 Redis set 실패(${gameId}): ${e.message}`);
  }
}

async function deleteSession(gameId) {
  if (!isReady()) return;
  try {
    await client.del(`${KEY_PREFIX}${gameId}`);
  } catch (e) {
    logger.warn(`명예투표 Redis del 실패(${gameId}): ${e.message}`);
  }
}

async function getSession(gameId) {
  if (!isReady()) return null;
  try {
    const raw = await client.get(`${KEY_PREFIX}${gameId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    logger.warn(`명예투표 Redis get 실패(${gameId}): ${e.message}`);
    return null;
  }
}

// 부팅 시 미마감 세션 전체 복원용
async function listSessions() {
  if (!isReady()) return [];
  const sessions = [];
  try {
    for await (const key of client.scanIterator({ MATCH: `${KEY_PREFIX}*`, COUNT: 100 })) {
      const raw = await client.get(key);
      if (raw) sessions.push(JSON.parse(raw));
    }
  } catch (e) {
    logger.warn(`명예투표 Redis scan 실패: ${e.message}`);
  }
  return sessions;
}

module.exports = { saveSession, deleteSession, getSession, listSessions };
