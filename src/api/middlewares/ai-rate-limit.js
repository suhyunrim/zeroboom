/**
 * AI 채팅 인당(puuid) 일일 호출 제한 — 인메모리.
 *
 * - 단일 컨테이너/단일 프로세스 운영이라 인메모리 Map으로 충분(분산 불필요).
 * - 컨테이너 재시작 시 카운터는 리셋된다(허용 가능한 손실 — 재시작은 드물다).
 * - 리셋 기준은 KST 자정(달력일). config.ai.dailyLimit <= 0 이면 무제한.
 */
const config = require('../../config');

// key(puuid) -> { day: 'YYYY-MM-DD'(KST), count }
const buckets = new Map();

// 주어진 epoch(ms)를 KST 기준 날짜 문자열로. KST = UTC+9.
function kstDay(nowMs) {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 한도 1회 소비 시도.
 * - 통과: 카운트 증가 후 { ok:true, used, remaining, limit }
 * - 초과: 카운트 증가 없이 { ok:false, used, remaining:0, limit }
 * @param {string} key 식별자(puuid)
 * @param {number} [nowMs] 현재 epoch(ms) — 테스트 주입용
 * @param {number} [limit] 한도 — 기본 config.ai.dailyLimit
 */
function consume(key, nowMs = Date.now(), limit = config.ai.dailyLimit) {
  if (!limit || limit <= 0) return { ok: true, used: 0, remaining: Infinity, limit: 0 }; // 무제한

  const day = kstDay(nowMs);
  const rec = buckets.get(key);

  if (!rec || rec.day !== day) {
    buckets.set(key, { day, count: 1 });
    return { ok: true, used: 1, remaining: limit - 1, limit };
  }
  if (rec.count >= limit) {
    return { ok: false, used: rec.count, remaining: 0, limit };
  }
  rec.count += 1;
  return { ok: true, used: rec.count, remaining: limit - rec.count, limit };
}

// 테스트용 초기화
function _reset() {
  buckets.clear();
}

module.exports = { consume, kstDay, _reset };
