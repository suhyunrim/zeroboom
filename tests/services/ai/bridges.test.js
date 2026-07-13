const {
  rankPlayers, rankVeterans, tallyRecentWins, computeAchievementProgress, projectCompareReport,
  computeCompositeStandings, teamSynergyPct,
} = require('../../../src/services/ai/bridges');

// 표준 Elo 기대승률(스케일 400) — 예상 순위 테스트용 stub
const elo = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));

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

describe('projectCompareReport (compare_players 투영, 순수 코어)', () => {
  const compareResult = {
    header: {
      a: { puuid: 'PUUID-A', name: 'A유저', rating: 600, rankTier: 'GOLD I', mainPosition: 'MIDDLE', wins: 10, losses: 5, winRate: 67 },
      b: { puuid: 'PUUID-B', name: 'B유저', rating: 900, rankTier: null, mainPosition: null, wins: 3, losses: 7, winRate: 30 },
    },
    headToHead: {
      games: 12, aWins: 9, bWins: 3, aWinRate: 75, recentResults: ['A'],
      currentStreak: { holder: 'B', count: 2 }, maxStreak: { a: 6, b: 2 },
    },
    together: { games: 5, wins: 4, losses: 1, winRate: 80, expectedWinRate: 55, synergyDelta: 25, positionCombos: [] },
    ratingFlow: { takenByA: 40, takenByB: 16, net: 24, computedGames: 12, skippedGames: 0 },
    timeline: {
      firstVs: { gameId: 1, date: 'D1', winner: 'A', aRating: 500, bRating: 510 },
      firstTogether: { gameId: 2, date: 'D2', won: true, aRating: 500, bRating: 510 },
      lastMetAt: 'D3', vsGames: 12, togetherGames: 5, totalGames: 17, monthlyCounts: [],
    },
    laneMatchup: { games: 1, aWins: 1, bWins: 0, byPosition: [] },
    relationTitles: [
      { key: 'natural_enemy', label: '천적', holder: 'A' },
      { key: 'love_hate', label: '애증의 관계' },
    ],
    mutualSynergy: {
      minGames: 5,
      minGamesA: 5,
      minGamesB: 5,
      goodWithBoth: [{
        puuid: 'PUUID-C',
        name: 'C유저',
        withA: { games: 5, wins: 5, winRate: 100 },
        withB: { games: 5, wins: 4, winRate: 80 },
        avgWinRate: 90,
      }],
      badWithBoth: [],
      goodForABadForB: [],
      goodForBBadForA: [],
    },
    tournament: {
      togetherChampionships: [{ tournamentId: 1, name: '대회', teamName: '팀', heldAt: 'D4' }],
      sameTeam: [{ tournamentId: 1, name: '대회', teamName: '팀', heldAt: 'D4' }],
      vs: {
        matches: 2,
        aWins: 1,
        bWins: 1,
        byTournament: [{ tournamentId: 2, name: '맞대결 대회', aTeamName: 'A의팀', bTeamName: 'B의팀', aWins: 1, bWins: 1 }],
      },
    },
    ratingTrajectory: { a: [], b: [] },
    matches: { total: 17, items: [] },
  };

  test('절대 레이팅은 티어로, puuid 미노출, holder는 이름으로 치환', () => {
    const r = projectCompareReport(compareResult);
    expect(r.a.ratingTier).toBe('PLATINUM IV'); // 600
    expect(r.b.ratingTier).toBe('MASTER'); // 900
    expect(r.a.rating).toBeUndefined(); // raw 미노출
    expect(JSON.stringify(r)).not.toContain('PUUID'); // puuid 전면 제거
    expect(r.headToHead.currentStreak).toEqual({ holderName: 'B유저', count: 2 });
    expect(r.headToHead.maxStreak).toEqual({ a: 6, b: 2 });
    expect(r.relationTitles).toEqual([
      { label: '천적', holderName: 'A유저' },
      { label: '애증의 관계' },
    ]);
    expect(r.timeline.firstVsWinnerName).toBe('A유저');
    expect(r.pointsFlow).toEqual({ takenByA: 40, takenByB: 16, net: 24 });
    expect(r.mutualSynergy.goodWithBoth[0]).toEqual({
      name: 'C유저',
      withA: { games: 5, wins: 5, winRate: 100 },
      withB: { games: 5, wins: 4, winRate: 80 },
      avgWinRate: 90,
    });
    expect(r.tournament.togetherChampionships).toEqual([{ name: '대회', teamName: '팀', heldAt: 'D4' }]);
    expect(r.tournament.vs).toEqual({
      matches: 2,
      aWins: 1,
      bWins: 1,
      byTournament: [{ name: '맞대결 대회', aTeamName: 'A의팀', bTeamName: 'B의팀', aWins: 1, bWins: 1 }], // tournamentId 미노출
    });
    // 궤적/경기 목록은 토큰 절약을 위해 미포함
    expect(r.ratingTrajectory).toBeUndefined();
    expect(r.matches).toBeUndefined();
  });

  test('연승/첫만남/타이틀이 없어도 안전', () => {
    const emptyish = {
      ...compareResult,
      headToHead: { ...compareResult.headToHead, currentStreak: { holder: null, count: 0 } },
      timeline: { ...compareResult.timeline, firstVs: null, firstTogether: null },
      relationTitles: [],
    };
    const r = projectCompareReport(emptyish);
    expect(r.headToHead.currentStreak).toBeNull();
    expect(r.timeline.firstVsDate).toBeNull();
    expect(r.timeline.firstVsWinnerName).toBeNull();
    expect(r.relationTitles).toEqual([]);
  });
});

describe('computeCompositeStandings (순수 코어)', () => {
  const T = (name, avgRating, extra = {}) => ({
    teamId: name,
    name,
    avgRating,
    teamRatingTier: avgRating == null ? null : `T${avgRating}`,
    positionFitScore: null,
    synergyPct: null,
    scrimRecord: { won: 0, lost: 0, played: 0 },
    members: [],
    ...extra,
  });
  const opts = (over = {}) => ({ expected: elo, ...over });

  test('요소 없으면 평균 레이팅 순서(강팀 1위)', () => {
    const r = computeCompositeStandings([T('약체', 400), T('강팀', 900), T('중간', 600)], opts());
    expect(r.map((t) => t.name)).toEqual(['강팀', '중간', '약체']);
    expect(r.map((t) => t.predictedRank)).toEqual([1, 2, 3]);
  });

  test('expectedWinRate: 두 팀이면 서로 상대라 합 100%', () => {
    const r = computeCompositeStandings([T('강팀', 800), T('약팀', 400)], opts());
    const strong = r.find((t) => t.name === '강팀');
    const weak = r.find((t) => t.name === '약팀');
    expect(strong.expectedWinRate).toBeGreaterThan(50);
    expect(strong.expectedWinRate + weak.expectedWinRate).toBeCloseTo(100, 1);
  });

  test('포지션 적합도가 낮으면 유효레이팅이 깎여 순위가 밀린다', () => {
    // 레이팅 동률이지만 A는 포지션 100(제자리), B는 60(오프)
    const r = computeCompositeStandings([T('A', 600, { positionFitScore: 100 }), T('B', 600, { positionFitScore: 60 })], opts());
    expect(r[0].name).toBe('A');
    expect(r.find((t) => t.name === 'A').expectedWinRate).toBeGreaterThan(50);
  });

  test('시너지가 높으면 순위가 오른다', () => {
    const r = computeCompositeStandings([T('A', 600, { synergyPct: 0 }), T('B', 600, { synergyPct: 20 })], opts());
    expect(r[0].name).toBe('B');
  });

  test('스크림 맞대결 결과가 레이팅 열세를 뒤집는다', () => {
    // A가 레이팅 우위(700 vs 500)지만 스크림에서 B에 0-6 대패 → B가 1위
    const teams = [T('A', 700), T('B', 500)];
    const pairScrim = (tA, tB) => {
      if (tA.name === 'A' && tB.name === 'B') return { aWon: 0, aLost: 6 };
      if (tA.name === 'B' && tB.name === 'A') return { aWon: 6, aLost: 0 };
      return { aWon: 0, aLost: 0 };
    };
    const r = computeCompositeStandings(teams, opts({ pairScrim }));
    expect(r[0].name).toBe('B');
    expect(r.find((t) => t.name === 'B').expectedWinRate).toBeGreaterThan(50);
  });

  test('raw avgRating은 제거, factor(포지션/시너지/스크림)는 노출', () => {
    const r = computeCompositeStandings([T('A', 500, { positionFitScore: 88, synergyPct: 3 })], opts());
    expect(r[0].avgRating).toBeUndefined();
    expect(r[0].positionFitScore).toBe(88);
    expect(r[0].synergyPct).toBe(3);
    expect(r[0].scrimRecord).toEqual({ won: 0, lost: 0, played: 0 });
    expect(r[0].teamRatingTier).toBeDefined();
  });

  test('레이팅 없는 팀은 순위 끝으로, expectedWinRate=null', () => {
    const r = computeCompositeStandings([T('신생', null), T('강팀', 800), T('약팀', 500)], opts());
    expect(r.map((t) => t.name)).toEqual(['강팀', '약팀', '신생']);
    expect(r[2].predictedRank).toBe(3);
    expect(r[2].expectedWinRate).toBeNull();
  });
});

describe('teamSynergyPct (순수 코어)', () => {
  test('같은팀 승률이 개인 기대치보다 높으면 +, 표본 부족 페어는 제외', () => {
    const indiv = { a: { games: 20, wins: 10 }, b: { games: 20, wins: 10 }, c: { games: 20, wins: 10 } };
    const pairStats = {
      'a|b': { games: 10, wins: 8 }, // 함께 80% vs 기대 50% → +30
      'a|c': { games: 2, wins: 2 }, // 표본 2판 < 5 → 제외
    };
    const r = teamSynergyPct(['a', 'b', 'c'], indiv, pairStats);
    expect(r).toBe(30);
  });

  test('인정 페어가 없으면 null', () => {
    const r = teamSynergyPct(['a', 'b'], { a: { games: 5, wins: 2 }, b: { games: 5, wins: 2 } }, {});
    expect(r).toBeNull();
  });
});
