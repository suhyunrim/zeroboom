const {
  computeMatchPositionScore,
  computeMatchPositionScores,
  computeTeamPositionScore,
} = require('../../src/match-maker/position-balance');

// ratingCache 형태의 플레이어 헬퍼
const P = (mainPos, mainRate, subPos = null, subRate = 0) => ({
  position: mainPos,
  mainPositionRate: mainRate,
  subPosition: subPos,
  subPositionRate: subRate,
});

// 5개 포지션을 1명씩, 충돌 없는 팀
const distinctTeam = (rate, sup = 'UTILITY') => [
  P('TOP', rate),
  P('JUNGLE', rate),
  P('MIDDLE', rate),
  P('BOTTOM', rate),
  P(sup, rate),
];

describe('computeMatchPositionScore', () => {
  it('전원 메인 + rate 100% → 100점', () => {
    expect(computeMatchPositionScore(distinctTeam(100), distinctTeam(100))).toBe(100);
  });

  it('전원 메인 + rate 95% → 100점 (천장 적용)', () => {
    expect(computeMatchPositionScore(distinctTeam(95), distinctTeam(95))).toBe(100);
  });

  it('전원 메인 + rate 70% → 74점', () => {
    // 0.7368... × 100 ≈ 73.68 → 반올림 74
    expect(computeMatchPositionScore(distinctTeam(70), distinctTeam(70))).toBe(74);
  });

  it('서폿 표기가 SUPPORT여도 UTILITY와 동일하게 정규화 처리', () => {
    expect(computeMatchPositionScore(distinctTeam(100, 'SUPPORT'), distinctTeam(100))).toBe(100);
  });

  it('미드 충돌(2명) → 1명이 오프로 밀려 점수 하락 (90점)', () => {
    // 미드 100% 2명 + 탑/정글/원딜 100% → 서폿 자리가 비어 미드 한 명이 오프(서폿)
    // 오프 편안도 = (100-100-0)/3 = 0 → 그 팀 fit 합 4.0, 상대 완벽팀 5.0 → (9/10)*100 = 90
    const conflict = [P('MIDDLE', 100), P('MIDDLE', 100), P('TOP', 100), P('JUNGLE', 100), P('BOTTOM', 100)];
    expect(computeMatchPositionScore(conflict, distinctTeam(100))).toBe(90);
  });

  it('서브 포지션으로 충돌 회피 시 서브 rate가 반영됨', () => {
    // 미드 2명이지만 한 명은 서브가 원딜(80%) → 원딜 자리를 서브로 메움
    const t1 = [
      P('MIDDLE', 100),
      P('MIDDLE', 90, 'BOTTOM', 80),
      P('TOP', 100),
      P('JUNGLE', 100),
      P('UTILITY', 100),
    ];
    // fit 합 = 4×1(메인 100) + min(1,80/95)=0.842 = 4.842, 상대 5.0 → (9.842/10)*100 = 98.42 → 98
    expect(computeMatchPositionScore(t1, distinctTeam(100))).toBe(98);
  });

  it('팀 인원이 5명이 아니면 null 반환', () => {
    expect(computeMatchPositionScore([P('TOP', 100)], distinctTeam(100))).toBeNull();
    expect(computeMatchPositionScore(null, distinctTeam(100))).toBeNull();
  });
});

describe('computeMatchPositionScores (팀별 + 종합)', () => {
  it('불균형 매치 — 한 팀만 오프가 몰리면 팀별 점수로 드러남', () => {
    // team1: 미드 충돌로 1명 오프 → 80점, team2: 완벽 → 100점, 종합 90점
    const conflict = [P('MIDDLE', 100), P('MIDDLE', 100), P('TOP', 100), P('JUNGLE', 100), P('BOTTOM', 100)];
    const scores = computeMatchPositionScores(conflict, distinctTeam(100));
    expect(scores.team1).toBe(80);
    expect(scores.team2).toBe(100);
    expect(scores.overall).toBe(90);
  });

  it('종합(overall)은 단축 함수 computeMatchPositionScore와 일치', () => {
    const conflict = [P('MIDDLE', 100), P('MIDDLE', 100), P('TOP', 100), P('JUNGLE', 100), P('BOTTOM', 100)];
    const scores = computeMatchPositionScores(conflict, distinctTeam(100));
    expect(scores.overall).toBe(computeMatchPositionScore(conflict, distinctTeam(100)));
  });

  it('computeTeamPositionScore — 단일 팀 점수 (전원 메인 100% → 100)', () => {
    expect(computeTeamPositionScore(distinctTeam(100))).toBe(100);
    expect(computeTeamPositionScore([P('TOP', 100)])).toBeNull();
  });

  it('5명이 아니면 팀별/종합 모두 null', () => {
    const scores = computeMatchPositionScores([P('TOP', 100)], distinctTeam(100));
    expect(scores).toEqual({ team1: null, team2: null, overall: null });
  });
});
