/**
 * 매칭 컨셉별 스코어링 모듈
 * 전체 매치 조합에서 각 컨셉에 맞는 최적 매치를 선택
 */

const { optimizePositionsForMatches } = require('./position-optimizer');

const CONCEPTS = [
  { key: 'balance', label: '밸런스', emoji: '⚖️', desc: '레이팅 차이를 최소화한 균형 매칭' },
  { key: 'aceDuel', label: '에이스', emoji: '⚔️', desc: '레이팅 1, 2위가 각 팀에서 캐리' },
  { key: 'position', label: '포지션', emoji: '🎯', desc: '주 포지션 배정을 최대한 맞춘 매칭' },
  { key: 'equalSpread', label: '편차균등', emoji: '📊', desc: '팀 내 실력 분포가 양 팀 동일' },
  { key: 'spearShield', label: '창과방패', emoji: '🛡️', desc: '실제 승률 기준으로 양 팀 균형' },
];

// 표준편차 계산
const stdev = (values) => {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map((v) => (v - avg) ** 2);
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
};

// 팀 멤버들의 레이팅 배열 추출
const getTeamRatings = (teamNames, ratingInfoMap) =>
  teamNames.map((name) => (ratingInfoMap[name]?.rating ?? 500));

// 팀 멤버들의 승률 배열 추출
const getTeamWinRates = (teamNames, ratingInfoMap) =>
  teamNames.map((name) => {
    const info = ratingInfoMap[name];
    if (!info || (info.win + info.lose) === 0) return 0.5;
    return info.win / (info.win + info.lose);
  });

/**
 * ⚖️ 밸런스 - 레이팅 차이 최소화 (이미 diff순 정렬)
 */
const selectBalance = (matches) => {
  return matches[0] || null;
};

/**
 * ⚔️ 에이스 대결 - 상위 2명을 양 팀에 배치
 */
const selectAceDuel = (matches, ratingInfoMap) => {
  // 전체 플레이어 레이팅 순 정렬
  const allPlayers = Object.entries(ratingInfoMap)
    .sort((a, b) => b[1].rating - a[1].rating);

  if (allPlayers.length < 2) return null;

  const top1 = allPlayers[0][0];
  const top2 = allPlayers[1][0];

  // 상위 2명이 다른 팀인 매치만 필터
  const filtered = matches.filter((m) => {
    const t1Has1 = m.team1Names.includes(top1);
    const t1Has2 = m.team1Names.includes(top2);
    return t1Has1 !== t1Has2; // 한 명만 team1에 있어야 함
  });

  return filtered[0] || null; // diff순이므로 첫 번째가 최적
};

/**
 * 🎯 포지션 우선 - position-optimizer 활용
 */
const selectPosition = (matches, playerDataMap) => {
  if (matches.length === 0) return null;

  const results = optimizePositionsForMatches(matches, playerDataMap, {
    topN: matches.length,
    resultCount: 1,
  });

  return results[0] || null;
};

/**
 * 📊 편차 균등 - 팀 내 레이팅 표준편차 차이 최소화
 */
const selectEqualSpread = (matches, ratingInfoMap) => {
  if (matches.length === 0) return null;

  let best = null;
  let bestScore = Infinity;

  for (const match of matches) {
    const t1Ratings = getTeamRatings(match.team1Names, ratingInfoMap);
    const t2Ratings = getTeamRatings(match.team2Names, ratingInfoMap);
    const stdevDiff = Math.abs(stdev(t1Ratings) - stdev(t2Ratings));

    // 편차 차이가 같으면 레이팅 밸런스가 좋은 쪽 (matches가 diff순이므로 먼저 발견된 것이 유리)
    if (stdevDiff < bestScore) {
      bestScore = stdevDiff;
      best = match;
    }
  }

  return best;
};

/**
 * 🛡️ 창과 방패 - 실제 승률 기준 밸런스
 */
const selectSpearShield = (matches, ratingInfoMap) => {
  if (matches.length === 0) return null;

  let best = null;
  let bestScore = Infinity;

  for (const match of matches) {
    const t1WinRates = getTeamWinRates(match.team1Names, ratingInfoMap);
    const t2WinRates = getTeamWinRates(match.team2Names, ratingInfoMap);
    const avg1 = t1WinRates.reduce((a, b) => a + b, 0) / t1WinRates.length;
    const avg2 = t2WinRates.reduce((a, b) => a + b, 0) / t2WinRates.length;
    const winRateDiff = Math.abs(avg1 - avg2);

    if (winRateDiff < bestScore) {
      bestScore = winRateDiff;
      best = match;
    }
  }

  return best;
};

/**
 * 5개 컨셉별 최적 매치 선택
 * @param {Array} matches - 전체 매치 배열 (diff순 정렬, 그룹 필터링 완료)
 * @param {Object} ratingInfoMap - { name: { rating, win, lose, ... } }
 * @param {Object} playerDataMap - position-optimizer용 데이터
 * @returns {Array} 컨셉별 최적 매치 배열 (conceptKey, conceptLabel, conceptEmoji 포함)
 */
const selectAllConcepts = (matches, ratingInfoMap, playerDataMap) => {
  // 레이팅 밸런스 상위 25%만 컨셉 스코어링 대상으로 사용 (diff순 정렬 상태)
  // 밸런스/에이스는 diff 기준이므로 전체 풀 사용, 나머지 컨셉은 밸런스 풀 사용
  const balancedPool = matches.slice(0, Math.max(Math.ceil(matches.length / 4), 10));

  const selectors = {
    balance: () => selectBalance(matches),
    aceDuel: () => selectAceDuel(matches, ratingInfoMap),
    position: () => selectPosition(balancedPool, playerDataMap),
    equalSpread: () => selectEqualSpread(balancedPool, ratingInfoMap),
    spearShield: () => selectSpearShield(balancedPool, ratingInfoMap),
  };

  const fallback = selectors.balance();

  return CONCEPTS.map((concept) => {
    const selected = selectors[concept.key]() || fallback;
    if (!selected) return null;
    return {
      ...selected,
      conceptKey: concept.key,
      conceptLabel: concept.label,
      conceptEmoji: concept.emoji,
      conceptDesc: concept.desc,
    };
  }).filter(Boolean);
};

module.exports = {
  CONCEPTS,
  selectAllConcepts,
  selectBalance,
  selectAceDuel,
  selectPosition,
  selectEqualSpread,
  selectSpearShield,
};
