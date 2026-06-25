/**
 * AI 채팅용 읽기 전용 SQL 탈출구.
 *
 * 브릿지(전용 도구)로 답할 수 없는 드문/복합 질문을, LLM이 직접 SELECT를 써서 답하게 한다.
 * "도구 없으면 천장" 문제의 가로축(롱테일). 단, LLM/SQL을 절대 신뢰하지 않고 경계에서 강제한다.
 *
 * 안전 모델(다층 방어 — 어느 한 겹이 뚫려도 다음 겹이 막는다):
 *  1) 전용 SELECT 전용 DB 유저로만 접속한다. 쓰기/DDL은 MySQL이 권한으로 거부한다(결정적 보증).
 *     이 커넥션은 앱의 읽기·쓰기 유저와 완전히 분리된다(절대 재사용 금지).
 *  2) 이 유저는 그룹 필터가 박힌 읽기 전용 뷰(ai_*)만 GRANT된다. base 테이블 접근·타그룹·민감 컬럼(puuid/discordId 등) 불가.
 *  3) 그룹 격리는 서버가 세션변수 @ai_group_id로 주입한다. 제출 SQL에 '@' 사용을 금지해 변수 조작을 막는다.
 *  4) SELECT/WITH만 허용 + 다중문(세미콜론)/주석/쓰기키워드 거부 + 행수·실행시간 상한.
 */
const Sequelize = require('sequelize');
const { QueryTypes } = require('sequelize');
const config = require('../../config');
const { logger } = require('../../loaders/logger');

const MAX_ROWS = 100; // 도구가 LLM에 돌려줄 최대 행수
const MAX_SQL_LEN = 2000;
const STATEMENT_TIMEOUT_MS = 3000; // 폭주 쿼리 차단(SELECT에만 적용되는 MySQL MAX_EXECUTION_TIME)

// 쓰기/DDL/위험 키워드(단어경계). 권한으로도 막히지만 조기 거부(방어 다층).
// 참고: 문자열 리터럴 안에 이 단어가 있으면 과도 거부될 수 있으나, 안전쪽 실패라 허용한다(LLM이 바꿔 쓰면 됨).
const FORBIDDEN = /\b(insert|update|delete|replace|drop|alter|create|truncate|grant|revoke|rename|call|lock|unlock|into|load|handler|prepare|execute|set|merge)\b/i;

/**
 * 제출된 SQL이 안전한 단일 SELECT인지 검증 (순수, 테스트 대상).
 * @param {string} sql
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
function validateSelect(sql) {
  if (typeof sql !== 'string' || !sql.trim()) return { ok: false, reason: 'SQL이 비어 있어요.' };
  let s = sql.trim();
  if (s.length > MAX_SQL_LEN) return { ok: false, reason: 'SQL이 너무 길어요.' };
  if (s.endsWith(';')) s = s.slice(0, -1).trim(); // 맨 끝 세미콜론 1개는 허용
  if (s.includes(';')) return { ok: false, reason: '여러 문장은 안 돼요(세미콜론 금지).' };
  if (s.includes('@')) return { ok: false, reason: '사용자 변수(@)는 쓸 수 없어요.' };
  if (s.includes('--') || s.includes('/*')) return { ok: false, reason: '주석은 쓸 수 없어요.' };
  if (!/^(select|with)\b/i.test(s)) return { ok: false, reason: 'SELECT(또는 WITH)로 시작해야 해요.' };
  if (FORBIDDEN.test(s)) return { ok: false, reason: '읽기 전용 SELECT만 허용돼요.' };
  return { ok: true };
}

function isConfigured() {
  return !!(config.aiSql && config.aiSql.user && config.aiSql.pass);
}

let _ro = null;
// 읽기 전용 전용 커넥션(앱 커넥션과 분리). DB 호스트/스키마는 메인과 같고 유저만 SELECT 전용.
function conn() {
  if (_ro) return _ro;
  const db = config.database;
  _ro = new Sequelize(db.database, config.aiSql.user, config.aiSql.pass, {
    host: db.host,
    port: db.port,
    dialect: 'mysql',
    logging: false,
    pool: { max: 2, min: 0, idle: 10000 },
    dialectOptions: { multipleStatements: false }, // 문장 스택(;) 원천 차단(기본값이지만 명시)
  });
  return _ro;
}

/**
 * 읽기 전용 SELECT 실행. groupId는 서버가 주입하며 세션변수로 격리된다(LLM 입력 아님).
 * @param {number} groupId
 * @param {{sql:string}} input
 * @returns {Promise<{rows:Array,rowCount:number,truncated:boolean}|{error:string}>}
 */
async function runReadonlyQuery(groupId, { sql } = {}) {
  if (!isConfigured()) return { error: 'SQL 조회 기능이 아직 설정되지 않았어요.' };
  if (!groupId) return { error: 'groupId가 필요합니다.' };
  const v = validateSelect(sql);
  if (!v.ok) return { error: v.reason };

  const ro = conn();
  try {
    // 트랜잭션으로 커넥션을 고정해야 @ai_group_id가 같은 연결에서 보인다.
    return await ro.transaction(async (t) => {
      await ro.query('SET @ai_group_id := :gid', { replacements: { gid: Number(groupId) }, transaction: t });
      await ro.query(`SET SESSION MAX_EXECUTION_TIME = ${STATEMENT_TIMEOUT_MS}`, { transaction: t });
      const rows = await ro.query(sql, { type: QueryTypes.SELECT, transaction: t });
      const list = Array.isArray(rows) ? rows : [];
      return { rowCount: list.length, truncated: list.length > MAX_ROWS, rows: list.slice(0, MAX_ROWS) };
    });
  } catch (e) {
    // SQL 오류 메시지는 뷰 컬럼명 수준이라 LLM이 스스로 고치게 그대로 돌려준다(민감정보 아님).
    logger.error(`[ai.sql] 쿼리 실패: ${e.message}`);
    return { error: `쿼리 실행 오류: ${e.message}` };
  }
}

module.exports = { validateSelect, isConfigured, runReadonlyQuery, MAX_ROWS };
