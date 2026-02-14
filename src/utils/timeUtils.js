/**
 * KST(UTC+9) 타임존 헬퍼
 * 서버 타임존에 관계없이 한국 시간 기준으로 동작
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * KST 기준 현재 연도
 */
function getKSTYear() {
  return new Date(Date.now() + KST_OFFSET_MS).getUTCFullYear();
}

/**
 * KST 기준 현재 월 (0-indexed)
 */
function getKSTMonth() {
  return new Date(Date.now() + KST_OFFSET_MS).getUTCMonth();
}

/**
 * 주어진 날짜의 KST 시간(0-23) 반환
 */
function getKSTHours(date) {
  return new Date(new Date(date).getTime() + KST_OFFSET_MS).getUTCHours();
}

/**
 * 주어진 날짜의 KST ISO 요일 반환 (1=월, 2=화, ..., 7=일)
 */
function getKSTIsoWeekday(date) {
  const day = new Date(new Date(date).getTime() + KST_OFFSET_MS).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * KST 기준 특정 월의 시작/종료 UTC Date 반환
 * DB 쿼리(Op.between)에 사용
 * @param {number} year
 * @param {number} month - 0-indexed
 */
function getKSTMonthRange(year, month) {
  const start = new Date(Date.UTC(year, month, 1) - KST_OFFSET_MS);
  const end = new Date(Date.UTC(year, month + 1, 1) - KST_OFFSET_MS - 1);
  return { start, end };
}

/**
 * KST 기준 해당 연도 1월 1일 00:00의 UTC Date 반환
 */
function getKSTYearStart(year) {
  if (!year) year = getKSTYear();
  return new Date(Date.UTC(year, 0, 1) - KST_OFFSET_MS);
}

/**
 * 현재로부터 N일 전의 Date 반환
 */
function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * 주어진 날짜에 N일을 더한 Date 반환
 */
function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);
}

module.exports = {
  KST_OFFSET_MS,
  getKSTYear,
  getKSTMonth,
  getKSTHours,
  getKSTIsoWeekday,
  getKSTMonthRange,
  getKSTYearStart,
  daysAgo,
  addDays,
};
