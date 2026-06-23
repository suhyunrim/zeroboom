/**
 * 포지션 적합도 점수 (0~100)
 *
 * 플랜(5:5 명단)은 아직 포지션이 정해지지 않은 상태라, 각 팀마다
 * "낼 수 있는 최선의 포지션 배정"을 120순열 완전탐색으로 찾아 그 적합도를 점수화한다.
 *
 * 공식:
 *   comfortᵢ = 메인 배정 → mainPositionRate
 *              서브 배정 → subPositionRate
 *              오프 배정 → (100 - main - sub) / 3   (남은 비율을 나머지 3포지션에 분배)
 *   fitᵢ  = min(1, comfortᵢ / 95)          // rate 95% 이상이면 만점(천장)
 *   점수  = round(100 × Σfit / 인원수)     // 전원 메인 95%+ → 100점
 */
const { POSITIONS, generatePermutations } = require('./position-optimizer');
const { normalizePosition } = require('../utils/tierUtils');

// rate 95% 이상을 만점으로 보는 천장 상수
const FIT_CEILING = 95;

// 오프포지션 편안도 추정: 남은 비율을 나머지 3포지션에 분배 (코드베이스 관례)
// 단순 0점(2-b)으로 바꾸려면 이 함수가 0을 반환하게 하면 됨
const offComfort = (mainRate, subRate) => Math.max(0, (100 - (mainRate || 0) - (subRate || 0)) / 3);

// ratingCache 형태의 플레이어를 포지션 정규화 (UTILITY → SUPPORT)
const normalizePlayer = (p) => ({
  mainPos: normalizePosition(p.position) || null,
  subPos: normalizePosition(p.subPosition) || null,
  mainPositionRate: p.mainPositionRate || 0,
  subPositionRate: p.subPositionRate || 0,
});

// 플레이어가 특정 포지션에 배정됐을 때의 편안도(0~100)
const comfortAt = (player, position) => {
  if (player.mainPos && player.mainPos === position) return player.mainPositionRate;
  if (player.subPos && player.subPos === position) return player.subPositionRate;
  return offComfort(player.mainPositionRate, player.subPositionRate);
};

// 한 팀(5명)의 최선 배정 fit 합 — 5! = 120순열 완전탐색
const bestTeamFitSum = (players) => {
  let best = -1;
  for (const perm of generatePermutations(POSITIONS)) {
    let sum = 0;
    for (let i = 0; i < players.length; i++) {
      sum += Math.min(1, comfortAt(players[i], perm[i]) / FIT_CEILING);
    }
    if (sum > best) best = sum;
  }
  return best;
};

/**
 * 한 팀(5명)의 포지션 적합도 점수 (0~100). 5명이 아니면 null.
 * @param {Array} teamPlayers - ratingCache 형태 [{ position, subPosition, mainPositionRate, subPositionRate }]
 * @returns {number|null}
 */
const computeTeamPositionScore = (teamPlayers) => {
  const size = POSITIONS.length; // 5
  if (!teamPlayers || teamPlayers.length !== size) return null;
  const fitSum = bestTeamFitSum(teamPlayers.map(normalizePlayer));
  return Math.round((fitSum / size) * 100);
};

/**
 * 매치(양 팀)의 포지션 적합도 점수. 팀별 점수와 종합(평균)을 함께 반환.
 * 각 팀이 5명이 아니면 모두 null.
 * @param {Array} team1 - ratingCache 형태
 * @param {Array} team2 - 동일
 * @returns {{ team1: number|null, team2: number|null, overall: number|null }}
 */
const computeMatchPositionScores = (team1, team2) => {
  const size = POSITIONS.length; // 5
  if (!team1 || !team2 || team1.length !== size || team2.length !== size) {
    return { team1: null, team2: null, overall: null };
  }
  // fit 합은 한 번만 계산 (팀/종합 점수 모두 동일 합에서 산출)
  const f1 = bestTeamFitSum(team1.map(normalizePlayer));
  const f2 = bestTeamFitSum(team2.map(normalizePlayer));
  return {
    team1: Math.round((f1 / size) * 100),
    team2: Math.round((f2 / size) * 100),
    overall: Math.round(((f1 + f2) / (size * 2)) * 100),
  };
};

// 종합 점수만 필요할 때의 단축 함수
const computeMatchPositionScore = (team1, team2) => computeMatchPositionScores(team1, team2).overall;

module.exports = {
  FIT_CEILING,
  computeTeamPositionScore,
  computeMatchPositionScores,
  computeMatchPositionScore,
  comfortAt,
  offComfort,
};
