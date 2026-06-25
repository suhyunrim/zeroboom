const { rankPlayers, computeAchievementProgress } = require('../../../src/services/ai/bridges');

const P = (name, win, lose, rating = 500, firstMatchDate = null) => ({
  name, win, lose, rating, firstMatchDate, rankTier: null, mainPosition: null,
});

describe('rankPlayers (순수 코어)', () => {
  const players = [
    P('많이한사람', 80, 70, 600), // 150판
    P('레이팅왕', 10, 5, 900), // 15판, 66.7%
    P('승률왕', 7, 3, 550), // 10판, 70%
    P('표본부족', 4, 0, 500), // 4판 100% (승률 표본 미달)
  ];

  test('games(판수) 내림차순 — 고인물', () => {
    const r = rankPlayers(players, { metric: 'games' });
    expect(r[0].name).toBe('많이한사람');
    expect(r[0].games).toBe(150);
    expect(r[0].rank).toBe(1);
  });

  test('rating 내림차순', () => {
    const r = rankPlayers(players, { metric: 'rating' });
    expect(r[0].name).toBe('레이팅왕');
  });

  test('winRate은 최소 5판 미만 표본을 제외', () => {
    const r = rankPlayers(players, { metric: 'winRate' });
    expect(r.find((p) => p.name === '표본부족')).toBeUndefined(); // 4판 제외
    expect(r[0].name).toBe('승률왕'); // 70%
    expect(r[0].value).toBe(70);
  });

  test('tenureDays — firstMatchDate 기준', () => {
    const old = new Date(Date.now() - 100 * 86400000).toISOString();
    const recent = new Date(Date.now() - 5 * 86400000).toISOString();
    const r = rankPlayers([P('고인', 1, 1, 500, old), P('뉴비', 1, 1, 500, recent)], { metric: 'tenureDays' });
    expect(r[0].name).toBe('고인');
    expect(r[0].value).toBeGreaterThanOrEqual(99);
  });

  test('limit 적용 + 알 수 없는 metric은 throw', () => {
    expect(rankPlayers(players, { metric: 'games', limit: 2 })).toHaveLength(2);
    expect(() => rankPlayers(players, { metric: 'nope' })).toThrow();
  });
});

describe('computeAchievementProgress (순수 코어)', () => {
  // 합성 정의 + statType 매핑 (실제 구조와 동일한 형태)
  const defs = [
    { id: 'A', name: '첫승', emoji: '🏆', tier: 'BRONZE', category: 'first', goal: 1 },
    { id: 'B', name: '50판', emoji: '📊', tier: 'GOLD', category: 'games', goal: 50 },
    { id: 'C', name: '6연승', emoji: '🔥', tier: 'GOLD', category: 'win_streak', goal: 6, description: '6연승' },
    { id: 'D', name: '명예', emoji: '✨', tier: 'GOLD', category: 'honor_special' }, // goal 없음 → 측정 불가
  ];
  const statTypeOf = (d) => ({ games: 'GAMES', win_streak: 'STREAK', first: 'FIRST' }[d.category] || null);

  test('획득/근접/측정불가를 분리하고 남은수로 정렬', () => {
    const unlocked = new Set(['A']); // 첫승만 달성
    const stats = { GAMES: 41, STREAK: 5 }; // 50판 중 41, 6연승 중 5
    const r = computeAchievementProgress(defs, unlocked, stats, statTypeOf);

    expect(r.totalCount).toBe(4);
    expect(r.earnedCount).toBe(1);
    expect(r.earned[0].id).toBe('A');

    // 근접: 6연승(남은 1) 이 50판(남은 9) 보다 앞
    expect(r.closest[0].id).toBe('C');
    expect(r.closest[0].remaining).toBe(1);
    expect(r.closest[1].id).toBe('B');
    expect(r.closest[1].remaining).toBe(9);
    expect(r.closest[1].progressRate).toBe(82); // 41/50

    // goal 없는 D는 측정 불가로 분류
    expect(r.otherLockedCount).toBe(1);
  });

  test('closestLimit 으로 개수 제한', () => {
    const r = computeAchievementProgress(defs, new Set(), { GAMES: 0, STREAK: 0, FIRST: 0 }, statTypeOf, { closestLimit: 1 });
    expect(r.closest).toHaveLength(1);
  });
});
