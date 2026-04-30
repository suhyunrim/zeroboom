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

/**
 * KST 기준 YYYYMMDD 숫자 키 (같은 날 판별용)
 */
function getKSTDateKey(date) {
  const d = new Date(new Date(date).getTime() + KST_OFFSET_MS);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/**
 * 주말 시간대 판별 (금 18시 ~ 월 06시, KST)
 */
function isWeekendTime(date) {
  const day = getKSTIsoWeekday(date); // 1=월, ..., 7=일
  const hour = getKSTHours(date);
  if (day === 6 || day === 7) return true; // 토, 일 전체
  if (day === 5 && hour >= 18) return true; // 금 18시 이후
  if (day === 1 && hour < 6) return true; // 월 06시 이전
  return false;
}

/**
 * 평일 시간대 판별 (주말 시간대의 여집합, 월 06시~금 18시)
 */
function isWeekdayTime(date) {
  return !isWeekendTime(date);
}

/**
 * 입력 시각이 속한 KST 날짜의 00:00:00.000 KST에 해당하는 UTC Date 반환
 */
function kstDayStart(input) {
  const d = new Date(new Date(input).getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - KST_OFFSET_MS);
}

/**
 * 입력 시각이 속한 KST 날짜의 23:59:59.999 KST에 해당하는 UTC Date 반환
 */
function kstDayEnd(input) {
  const d = new Date(new Date(input).getTime() + KST_OFFSET_MS);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999) - KST_OFFSET_MS,
  );
}

/**
 * YYYYMMDD 숫자 키 간의 일수 차이 (key1 - key2). 실제 달력 기준.
 */
function kstDayKeyDiff(key1, key2) {
  const parse = (k) => {
    const y = Math.floor(k / 10000);
    const m = Math.floor((k % 10000) / 100) - 1;
    const d = k % 100;
    return Date.UTC(y, m, d);
  };
  return Math.round((parse(key1) - parse(key2)) / (24 * 60 * 60 * 1000));
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
  getKSTDateKey,
  isWeekendTime,
  isWeekdayTime,
  kstDayStart,
  kstDayEnd,
  kstDayKeyDiff,
};
