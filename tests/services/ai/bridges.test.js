const { rankPlayers, rankVeterans, tallyRecentWins, computeAchievementProgress } = require('../../../src/services/ai/bridges');

const P = (name, win, lose, rating = 500, firstMatchDate = null) => ({
  name, win, lose, rating, firstMatchDate, rankTier: null, mainPosition: null,
});

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

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

  test('내전 레이팅은 티어로 환산하고 raw 점수는 노출하지 않는다', () => {
    const r = rankPlayers(players, { metric: 'rating' });
    expect(r[0].name).toBe('레이팅왕'); // 900 최고
    expect(r[0].value).toBe('MASTER'); // 메트릭 값이 raw 숫자가 아니라 티어
    expect(r[0].ratingTier).toBe('MASTER');
    expect(r[0].rating).toBeUndefined(); // raw 점수 필드 없음
  });

  test('모든 엔트리에 ratingTier(내전 티어) 문자열 포함', () => {
    const r = rankPlayers(players, { metric: 'games' });
    expect(r.find((p) => p.name === '많이한사람').ratingTier).toBe('PLATINUM IV'); // 600
    r.forEach((p) => expect(typeof p.ratingTier).toBe('string'));
  });
});

describe('rankVeterans (고인물 종합 — 순수 코어)', () => {
  // 스크린샷 시나리오 재현: 쥬티키스=판수 압도(326)·가입 164일, NO TOUCH=240·165일,
  // 강빈=204·165일, 올드비=20판이지만 최고참(200일).
  const roster = [
    P('쥬티키스', 200, 126, 500, daysAgo(164)), // 326판
    P('NO TOUCH', 140, 100, 500, daysAgo(165)), // 240판
    P('강빈', 120, 84, 500, daysAgo(165)), // 204판
    P('올드비', 10, 10, 500, daysAgo(200)), // 20판, 최고참
  ];

  test('판수 압도 + 가입 사실상 동급이면 종합 1위(정규화 합성, 하루 차 왜곡 없음)', () => {
    const r = rankVeterans(roster);
    expect(r[0].name).toBe('쥬티키스'); // 326판 + 164일 → 종합 1위
    expect(r[0].rank).toBe(1);
    // grounded 순위: 판수 1위, 가입은 4위지만 값(164일)도 함께 제공
    expect(r[0].gamesRank).toBe(1);
    expect(r[0].tenureDays).toBeGreaterThanOrEqual(163);
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });

  test('가입일 동점은 같은 순위(competition ranking)', () => {
    const r = rankVeterans(roster);
    const noTouch = r.find((p) => p.name === 'NO TOUCH');
    const gangbin = r.find((p) => p.name === '강빈');
    expect(noTouch.tenureRank).toBe(gangbin.tenureRank); // 둘 다 165일 → 같은 가입순위
  });

  test('모든 사람이 grounded 순위/값을 갖는다(누구도 누락=순위권밖 없음)', () => {
    const r = rankVeterans(roster);
    expect(r).toHaveLength(4);
    r.forEach((p) => {
      expect(p.gamesRank).toBeGreaterThanOrEqual(1);
      expect(p.tenureRank).toBeGreaterThanOrEqual(1);
      expect(typeof p.score).toBe('number');
    });
  });

  test('limit 적용 / 빈 입력은 빈 배열', () => {
    expect(rankVeterans(roster, { limit: 2 })).toHaveLength(2);
    expect(rankVeterans([])).toEqual([]);
  });
});

describe('tallyRecentWins (최근 N판 승리 집계 — 순수 코어)', () => {
  // 매치 팀 요소는 [puuid, name, rating, position] 형태지만 집계는 puuid(0번)만 쓴다.
  const M = (winTeam, t1, t2) => ({
    winTeam,
    team1: t1.map((puuid) => [puuid, 'n', 500, 'TOP']),
    team2: t2.map((puuid) => [puuid, 'n', 500, 'TOP']),
  });
  const names = { a: '에이', b: '비이', c: '시이', d: '디이' };

  test('승리팀 전원 1승·패배팀 전원 1패, 승수 내림차순 + 윈도우 안에서만 집계', () => {
    const matches = [
      M(1, ['a', 'b'], ['c', 'd']), // a,b 승 / c,d 패
      M(2, ['a', 'c'], ['b', 'd']), // 승팀=team2(b,d) / 패팀=team1(a,c)
      M(1, ['a', 'd'], ['b', 'c']), // a,d 승 / b,c 패
    ];
    const r = tallyRecentWins(matches, names, { topN: 5 });
    const a = r.find((p) => p.name === '에이');
    expect(a).toMatchObject({ wins: 2, losses: 1, games: 3 }); // 1·3번 승, 2번 패
    expect(a.winRate).toBe(66.7);
    expect(r[0].rank).toBe(1);
    expect(r[0].wins).toBeGreaterThanOrEqual(r[1].wins); // 승수 정렬
    expect(r.find((p) => p.name === '시이')).toMatchObject({ wins: 0, losses: 3 });
  });

  test('winTeam이 null이면 그 매치는 집계에서 제외', () => {
    const matches = [M(1, ['a'], ['b']), { winTeam: null, team1: [['a']], team2: [['b']] }];
    const r = tallyRecentWins(matches, names);
    expect(r.find((p) => p.name === '에이').games).toBe(1); // null 매치 미집계
  });

  test('topN 제한 + 이름 없는 puuid는 "알 수 없음"', () => {
    const matches = [M(1, ['a', 'x'], ['b', 'c'])];
    expect(tallyRecentWins(matches, names, { topN: 2 })).toHaveLength(2);
    expect(tallyRecentWins(matches, names).find((p) => p.name === '알 수 없음')).toBeDefined(); // x 매핑 없음
  });

  test('빈/누락 입력은 빈 배열', () => {
    expect(tallyRecentWins([], names)).toEqual([]);
    expect(tallyRecentWins(undefined)).toEqual([]);
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
