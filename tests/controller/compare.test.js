const mockModels = {
  user: {
    findAll: jest.fn(),
  },
  match: {
    findAll: jest.fn(),
  },
  summoner: {
    findAll: jest.fn(),
  },
  externalRecord: {
    findAll: jest.fn(),
  },
  tournament: {
    findAll: jest.fn(),
  },
  tournament_team: {
    findAll: jest.fn(),
  },
  tournament_match: {
    findAll: jest.fn(),
  },
};

jest.mock('../../src/db/models', () => mockModels);

const compareController = require('../../src/controller/compare');

// [puuid, name, rating, position] 스냅샷 플레이어
const p = (puuid, rating = 500, position = null) => [puuid, `n-${puuid}`, rating, position];
// 스냅샷 없는 옛 포맷 [puuid, name]
const pOld = (puuid) => [puuid, `n-${puuid}`];

let nextGameId = 1;
const m = (team1, team2, winTeam, dateStr = '2025-02-01T00:00:00Z') => ({
  gameId: nextGameId++,
  team1: JSON.stringify(team1),
  team2: JSON.stringify(team2),
  winTeam,
  createdAt: new Date(dateStr),
});

const userRow = (puuid, win, lose, defaultRating, additionalRating) => ({
  puuid,
  win,
  lose,
  defaultRating,
  additionalRating,
});

beforeEach(() => {
  jest.clearAllMocks();
  nextGameId = 1;
  mockModels.summoner.findAll.mockResolvedValue([]);
  mockModels.externalRecord.findAll.mockResolvedValue([]);
  mockModels.tournament.findAll.mockResolvedValue([]);
  mockModels.tournament_team.findAll.mockResolvedValue([]);
  mockModels.tournament_match.findAll.mockResolvedValue([]);
});

test('한 명이라도 그룹에 없으면 404', async () => {
  mockModels.user.findAll.mockResolvedValueOnce([userRow('PA', 0, 0, 500, 0)]);
  mockModels.match.findAll.mockResolvedValue([]);

  const r = await compareController.compareUsers(1, 'PA', 'PB');
  expect(r.status).toBe(404);
});

describe('상대전적/시너지/타임라인/점수이동 집계', () => {
  const setup = () => {
    // 시간순:
    // g1 vs: [PA,PC] vs [PB,PD] 1팀 승 → A 승 (전원 500 → delta 8)
    // g2 vs: [PB,PC] vs [PA,PD] 1팀 승 → B 승
    // g3 vs: [PA,PD] vs [PB,PE] 1팀 승 → A 승
    // g4 vs(옛 포맷, 스냅샷 없음): [PA,PD] vs [PB,PE] 2팀 승 → B 승, 점수 계산 스킵
    // g5 같은팀: [PA,PB] vs [PC,PD] 1팀 승 → 승
    // g6 같은팀: [PC,PD] vs [PA,PB] 1팀 승 → 패
    // g7 A만 참여: [PA,PC] vs [PD,PE] 1팀 승
    // g8 B만 참여: [PB,PC] vs [PD,PE] 1팀 승
    const matches = [
      // g1은 A/B 둘 다 MIDDLE로 맞팀 → 맞라인 전적 1판
      m([p('PA', 500, 'MIDDLE'), p('PC')], [p('PB', 500, 'MIDDLE'), p('PD')], 1, '2025-01-01T00:00:00Z'),
      m([p('PB'), p('PC')], [p('PA'), p('PD')], 1, '2025-01-02T00:00:00Z'),
      m([p('PA'), p('PD')], [p('PB'), p('PE')], 1, '2025-01-03T00:00:00Z'),
      m([pOld('PA'), pOld('PD')], [pOld('PB'), pOld('PE')], 2, '2025-01-03T12:00:00Z'),
      // g5/g6은 A=JUNGLE, B=MIDDLE 같은팀 조합 2판(1승 1패)
      m([p('PA', 500, 'JUNGLE'), p('PB', 500, 'MIDDLE')], [p('PC'), p('PD')], 1, '2025-01-04T00:00:00Z'),
      m([p('PC'), p('PD')], [p('PA', 500, 'JUNGLE'), p('PB', 500, 'MIDDLE')], 1, '2025-01-05T00:00:00Z'),
      m([p('PA', 508), p('PC')], [p('PD'), p('PE')], 1, '2025-01-06T00:00:00Z'),
      m([p('PB'), p('PC')], [p('PD'), p('PE')], 1, '2025-01-07T00:00:00Z'),
    ];
    mockModels.user.findAll
      .mockResolvedValueOnce([userRow('PA', 10, 5, 500, 30), userRow('PB', 4, 6, 500, -20)])
      .mockResolvedValueOnce([]); // 제외 대상 없음
    mockModels.match.findAll.mockResolvedValue(matches);
    mockModels.summoner.findAll.mockResolvedValue([
      { puuid: 'PA', name: 'AName', rankTier: 'GOLD II', mainPosition: 'MID' },
      { puuid: 'PB', name: 'BName', rankTier: 'SILVER I', mainPosition: 'JUNGLE' },
    ]);
    mockModels.externalRecord.findAll.mockResolvedValue([{ puuid: 'PA', win: 2, lose: 1 }]);
  };

  test('headToHead: 승패, 최근 흐름, 현재 연승', async () => {
    setup();
    const { status, result } = await compareController.compareUsers(1, 'PA', 'PB');
    expect(status).toBe(200);
    expect(result.headToHead).toEqual({
      games: 4,
      aWins: 2,
      bWins: 2,
      aWinRate: 50,
      recentResults: ['A', 'B', 'A', 'B'],
      currentStreak: { holder: 'B', count: 1 },
      maxStreak: { a: 1, b: 1 },
    });
  });

  test('together: 같은팀 승률과 개인 통산 대비 시너지', async () => {
    setup();
    const { result } = await compareController.compareUsers(1, 'PA', 'PB');
    // A 통산 7판 4승(57%), B 통산 7판 4승(57%) → 기대 57, 같은팀 50% → delta -7
    expect(result.together).toEqual({
      games: 2,
      wins: 1,
      losses: 1,
      winRate: 50,
      expectedWinRate: 57,
      synergyDelta: -7,
      positionCombos: [{ aPosition: 'JUNGLE', bPosition: 'MIDDLE', games: 2, wins: 1, winRate: 50 }],
    });
  });

  test('ratingFlow: 스냅샷으로 재계산한 delta 합, 스냅샷 없는 매치는 스킵', async () => {
    setup();
    const { result } = await compareController.compareUsers(1, 'PA', 'PB');
    // 전원 500 → 승팀 delta = round(500 + 16*0.5) - 500 = 8
    expect(result.ratingFlow).toEqual({
      takenByA: 16,
      takenByB: 8,
      net: 8,
      computedGames: 3,
      skippedGames: 1,
    });
  });

  test('timeline: 첫 맞대결/첫 같은팀/마지막 만남/월별 카운트', async () => {
    setup();
    const { result } = await compareController.compareUsers(1, 'PA', 'PB');
    expect(result.timeline.firstVs).toMatchObject({
      gameId: 1,
      winner: 'A',
      aRating: 500,
      bRating: 500,
    });
    expect(result.timeline.firstTogether).toMatchObject({ gameId: 5, won: true });
    expect(result.timeline.lastMetAt).toEqual(new Date('2025-01-05T00:00:00Z'));
    expect(result.timeline.vsGames).toBe(4);
    expect(result.timeline.togetherGames).toBe(2);
    expect(result.timeline.totalGames).toBe(6);
    expect(result.timeline.monthlyCounts).toEqual([{ month: '2025-01', games: 6 }]);
  });

  test('matches: 최신순 리스트, 옛 포맷은 레이팅 null', async () => {
    setup();
    const { result } = await compareController.compareUsers(1, 'PA', 'PB');
    expect(result.matches.total).toBe(6);
    expect(result.matches.items.map((i) => i.gameId)).toEqual([6, 5, 4, 3, 2, 1]);
    const g4 = result.matches.items.find((i) => i.gameId === 4);
    expect(g4).toMatchObject({ sameTeam: false, aWon: false, bWon: true, aRating: null, bRating: null });
    const g5 = result.matches.items.find((i) => i.gameId === 5);
    expect(g5).toMatchObject({ sameTeam: true, aWon: true, bWon: true });
  });

  test('header: 레이팅 합산, 외부 기록 승패 합산, 소환사 정보', async () => {
    setup();
    const { result } = await compareController.compareUsers(1, 'PA', 'PB');
    expect(result.header.a).toEqual({
      puuid: 'PA',
      name: 'AName',
      rating: 530,
      rankTier: 'GOLD II',
      mainPosition: 'MID',
      wins: 12, // 10 + 외부 2
      losses: 6, // 5 + 외부 1
      winRate: 67,
    });
    expect(result.header.b).toMatchObject({ name: 'BName', rating: 480, wins: 4, losses: 6, winRate: 40 });
  });

  test('판수 부족하면 mutualSynergy 리스트는 비어 있음', async () => {
    setup();
    const { result } = await compareController.compareUsers(1, 'PA', 'PB');
    expect(result.mutualSynergy.goodWithBoth).toEqual([]);
    expect(result.mutualSynergy.badWithBoth).toEqual([]);
  });

  test('laneMatchup: 같은 포지션 맞팀 경기만 집계', async () => {
    setup();
    const { result } = await compareController.compareUsers(1, 'PA', 'PB');
    expect(result.laneMatchup).toEqual({
      games: 1,
      aWins: 1,
      bWins: 0,
      byPosition: [{ position: 'MIDDLE', games: 1, aWins: 1, bWins: 0 }],
    });
  });

  test('relationTitles: 판수 기준 미달이면 빈 배열', async () => {
    setup();
    const { result } = await compareController.compareUsers(1, 'PA', 'PB');
    expect(result.relationTitles).toEqual([]);
  });

  test('ratingTrajectory: 스냅샷 있는 매치만 KST 일 단위로 수집', async () => {
    setup();
    const { result } = await compareController.compareUsers(1, 'PA', 'PB');
    // A: g1~g3(500), g4는 스냅샷 없어 제외, g5·g6(500), g7(508) → 6일
    expect(result.ratingTrajectory.a).toHaveLength(6);
    expect(result.ratingTrajectory.a[result.ratingTrajectory.a.length - 1]).toEqual({
      date: '2025-01-06',
      rating: 508,
    });
    // B: g1~g3, g5, g6, g8 → 6일
    expect(result.ratingTrajectory.b).toHaveLength(6);
    expect(result.ratingTrajectory.b[0]).toEqual({ date: '2025-01-01', rating: 500 });
  });
});

describe('relationTitles: 관계 타이틀 부여', () => {
  const setupWith = (matches) => {
    mockModels.user.findAll
      .mockResolvedValueOnce([userRow('PA', 0, 0, 500, 0), userRow('PB', 0, 0, 500, 0)])
      .mockResolvedValueOnce([]);
    mockModels.match.findAll.mockResolvedValue(matches);
  };
  const repeat = (matches, count, team1, team2, winTeam) => {
    for (let i = 0; i < count; i++) matches.push(m(team1(), team2(), winTeam));
  };

  test('천적(65%+/10판+) + 환상의 듀오(60%+/10판+) + 애증(둘 다 10판+)', async () => {
    const matches = [];
    // 맞대결 12판 중 A 9승 (75%)
    repeat(
      matches,
      9,
      () => [p('PA'), p('PX')],
      () => [p('PB'), p('PY')],
      1,
    );
    repeat(
      matches,
      3,
      () => [p('PA'), p('PX')],
      () => [p('PB'), p('PY')],
      2,
    );
    // 같은팀 10판 중 7승 (70%)
    repeat(
      matches,
      7,
      () => [p('PA'), p('PB')],
      () => [p('PX'), p('PY')],
      1,
    );
    repeat(
      matches,
      3,
      () => [p('PA'), p('PB')],
      () => [p('PX'), p('PY')],
      2,
    );
    setupWith(matches);

    const { result } = await compareController.compareUsers(1, 'PA', 'PB');
    expect(result.relationTitles).toEqual([
      { key: 'natural_enemy', label: '천적', holder: 'A' },
      { key: 'fantastic_duo', label: '환상의 듀오' },
      { key: 'love_hate', label: '애증의 관계' },
    ]);
    // 역대 최다 연승: A 9연승(9연속 승) / B 3연승(마지막 3연속)
    expect(result.headToHead.maxStreak).toEqual({ a: 9, b: 3 });
  });

  test('숙명의 라이벌(45~55%/20판+), 듀오 승률 미달이면 제외', async () => {
    const matches = [];
    // 맞대결 20판 10:10 (50%)
    repeat(
      matches,
      10,
      () => [p('PA'), p('PX')],
      () => [p('PB'), p('PY')],
      1,
    );
    repeat(
      matches,
      10,
      () => [p('PA'), p('PX')],
      () => [p('PB'), p('PY')],
      2,
    );
    // 같은팀 10판 5승 (50% → 듀오 미달, 애증은 충족)
    repeat(
      matches,
      5,
      () => [p('PA'), p('PB')],
      () => [p('PX'), p('PY')],
      1,
    );
    repeat(
      matches,
      5,
      () => [p('PA'), p('PB')],
      () => [p('PX'), p('PY')],
      2,
    );
    setupWith(matches);

    const { result } = await compareController.compareUsers(1, 'PA', 'PB');
    expect(result.relationTitles).toEqual([
      { key: 'fated_rivals', label: '숙명의 라이벌' },
      { key: 'love_hate', label: '애증의 관계' },
    ]);
  });
});

describe('mutualSynergy: 둘 다와의 시너지 좋은/나쁜 유저', () => {
  test('최소 판수·경계 필터·제외 대상·상대방 본인 제외', async () => {
    const matches = [];
    const repeat = (count, team1, team2, winTeam) => {
      for (let i = 0; i < count; i++) matches.push(m(team1(), team2(), winTeam));
    };

    // PC: A와 5판 5승, B와 5판 5승 → good
    repeat(
      5,
      () => [p('PA'), p('PC')],
      () => [p('PX'), p('PY')],
      1,
    );
    repeat(
      5,
      () => [p('PB'), p('PC')],
      () => [p('PX'), p('PY')],
      1,
    );
    // PD: A와 5판 0승, B와 5판 0승 → bad
    repeat(
      5,
      () => [p('PA'), p('PD')],
      () => [p('PX'), p('PY')],
      2,
    );
    repeat(
      5,
      () => [p('PB'), p('PD')],
      () => [p('PX'), p('PY')],
      2,
    );
    // PE: A와 4판(최소 판수 미달), B와 5판 → 제외
    repeat(
      4,
      () => [p('PA'), p('PE')],
      () => [p('PX'), p('PY')],
      1,
    );
    repeat(
      5,
      () => [p('PB'), p('PE')],
      () => [p('PX'), p('PY')],
      1,
    );
    // PF: 둘 다와 5판 5승이지만 outsider/탈퇴 → 제외
    repeat(
      5,
      () => [p('PA'), p('PF')],
      () => [p('PX'), p('PY')],
      1,
    );
    repeat(
      5,
      () => [p('PB'), p('PF')],
      () => [p('PX'), p('PY')],
      1,
    );
    // PG: 둘 다와 6판 3승(50%) → 경계 필터로 어느 리스트에도 없음
    repeat(
      3,
      () => [p('PA'), p('PG')],
      () => [p('PX'), p('PY')],
      1,
    );
    repeat(
      3,
      () => [p('PA'), p('PG')],
      () => [p('PX'), p('PY')],
      2,
    );
    repeat(
      3,
      () => [p('PB'), p('PG')],
      () => [p('PX'), p('PY')],
      1,
    );
    repeat(
      3,
      () => [p('PB'), p('PG')],
      () => [p('PX'), p('PY')],
      2,
    );
    // PH: A와 5판 5승, B와 5판 0승 → 엇갈린 시너지 (A에겐 승요, B에겐 패요)
    repeat(
      5,
      () => [p('PA'), p('PH')],
      () => [p('PX'), p('PY')],
      1,
    );
    repeat(
      5,
      () => [p('PB'), p('PH')],
      () => [p('PX'), p('PY')],
      2,
    );
    // PA-PB 같은 팀 5판 5승 → 서로는 mutual 리스트에 나오지 않아야 함
    repeat(
      5,
      () => [p('PA'), p('PB')],
      () => [p('PX'), p('PY')],
      1,
    );

    mockModels.user.findAll
      .mockResolvedValueOnce([userRow('PA', 0, 0, 500, 0), userRow('PB', 0, 0, 500, 0)])
      .mockResolvedValueOnce([{ puuid: 'PF' }]);
    mockModels.match.findAll.mockResolvedValue(matches);
    mockModels.summoner.findAll.mockResolvedValue([
      { puuid: 'PA', name: 'AName' },
      { puuid: 'PB', name: 'BName' },
      { puuid: 'PC', name: 'CName' },
      { puuid: 'PD', name: 'DName' },
      { puuid: 'PH', name: 'HName' },
    ]);

    const { result } = await compareController.compareUsers(1, 'PA', 'PB');

    // A/B 전체 35·36판 → 5%는 2지만 하한 5로 클램프
    expect(result.mutualSynergy.minGamesA).toBe(5);
    expect(result.mutualSynergy.minGamesB).toBe(5);
    expect(result.mutualSynergy.goodWithBoth).toEqual([
      {
        puuid: 'PC',
        name: 'CName',
        withA: { games: 5, wins: 5, winRate: 100 },
        withB: { games: 5, wins: 5, winRate: 100 },
        avgWinRate: 100,
      },
    ]);
    expect(result.mutualSynergy.badWithBoth).toEqual([
      {
        puuid: 'PD',
        name: 'DName',
        withA: { games: 5, wins: 0, winRate: 0 },
        withB: { games: 5, wins: 0, winRate: 0 },
        avgWinRate: 0,
      },
    ]);
    // 엇갈린 시너지: PH는 A에겐 100%, B에겐 0%
    expect(result.mutualSynergy.goodForABadForB).toEqual([
      {
        puuid: 'PH',
        name: 'HName',
        withA: { games: 5, wins: 5, winRate: 100 },
        withB: { games: 5, wins: 0, winRate: 0 },
        avgWinRate: 50,
      },
    ]);
    expect(result.mutualSynergy.goodForBBadForA).toEqual([]);

    // 같은 팀 5판은 together에 집계
    expect(result.together.games).toBe(5);
    expect(result.together.wins).toBe(5);
    // A-B가 서로 맞선 경기는 없음
    expect(result.headToHead.games).toBe(0);
    expect(result.ratingFlow).toEqual({
      takenByA: 0,
      takenByB: 0,
      net: 0,
      computedGames: 0,
      skippedGames: 0,
    });
  });
});

describe('tournament: 토너먼트 인연', () => {
  test('같은 팀/함께 우승/맞대결 매치 집계', async () => {
    mockModels.user.findAll
      .mockResolvedValueOnce([userRow('PA', 0, 0, 500, 0), userRow('PB', 0, 0, 500, 0)])
      .mockResolvedValueOnce([]);
    mockModels.match.findAll.mockResolvedValue([]);
    mockModels.tournament.findAll.mockResolvedValue([
      // t1: 같은 팀으로 우승 / t2: 서로 다른 팀(맞대결) / t3: 진행중 맞대결 / t4: B만 참가
      { id: 1, name: '1회 대회', status: 'finished', championTeamId: 11, heldAt: new Date('2026-05-01') },
      { id: 2, name: '2회 대회', status: 'finished', championTeamId: 99, heldAt: new Date('2026-06-01') },
      { id: 3, name: '3회 대회', status: 'in_progress', championTeamId: null, heldAt: new Date('2026-07-01') },
      { id: 4, name: '4회 대회', status: 'finished', championTeamId: 41, heldAt: new Date('2026-07-05') },
    ]);
    mockModels.tournament_team.findAll.mockResolvedValue([
      { id: 11, tournamentId: 1, name: '우승팀', members: [{ puuid: 'PA' }, { puuid: 'PB' }] },
      { id: 21, tournamentId: 2, name: 'A팀', members: JSON.stringify([{ puuid: 'PA' }]) }, // 문자열 JSON도 파싱
      { id: 22, tournamentId: 2, name: 'B팀', members: [{ puuid: 'PB' }] },
      { id: 31, tournamentId: 3, name: 'A2팀', members: [{ puuid: 'PA' }] },
      { id: 32, tournamentId: 3, name: 'B2팀', members: [{ puuid: 'PB' }] },
      { id: 41, tournamentId: 4, name: 'B만', members: [{ puuid: 'PB' }] },
    ]);
    mockModels.tournament_match.findAll.mockResolvedValue([
      { tournamentId: 2, team1Id: 21, team2Id: 22, winnerTeamId: 21 }, // A 승
      { tournamentId: 2, team1Id: 22, team2Id: 21, winnerTeamId: 21 }, // 역순 배치, A 승
      { tournamentId: 2, team1Id: 23, team2Id: 24, winnerTeamId: 23 }, // 다른 팀끼리 → 무시
      { tournamentId: 3, team1Id: 31, team2Id: 32, winnerTeamId: 32 }, // B 승
    ]);

    const { result } = await compareController.compareUsers(1, 'PA', 'PB');
    expect(result.tournament.sameTeam).toEqual([
      { tournamentId: 1, name: '1회 대회', teamName: '우승팀', heldAt: new Date('2026-05-01') },
    ]);
    expect(result.tournament.togetherChampionships).toEqual(result.tournament.sameTeam);
    expect(result.tournament.vs).toEqual({ matches: 3, aWins: 2, bWins: 1 });
    // 승자 미확정 매치만 있으면 조회 자체가 winnerTeamId != null 필터라 집계 제외 (mock 상 생략)
  });

  test('토너먼트가 없으면 빈 결과', async () => {
    mockModels.user.findAll
      .mockResolvedValueOnce([userRow('PA', 0, 0, 500, 0), userRow('PB', 0, 0, 500, 0)])
      .mockResolvedValueOnce([]);
    mockModels.match.findAll.mockResolvedValue([]);

    const { result } = await compareController.compareUsers(1, 'PA', 'PB');
    expect(result.tournament).toEqual({
      togetherChampionships: [],
      sameTeam: [],
      vs: { matches: 0, aWins: 0, bWins: 0 },
    });
    expect(mockModels.tournament_team.findAll).not.toHaveBeenCalled();
  });
});

describe('mutualMinGames: 동적 하한 = max(5, min(12, round(전체판수*5%)))', () => {
  test('소표본은 하한 5, 고표본은 상한 12로 클램프', () => {
    expect(compareController.mutualMinGames(0)).toBe(5);
    expect(compareController.mutualMinGames(40)).toBe(5); // round(2)=2 → 5
    expect(compareController.mutualMinGames(100)).toBe(5); // round(5)=5
    expect(compareController.mutualMinGames(160)).toBe(8); // round(8)=8
    expect(compareController.mutualMinGames(300)).toBe(12); // round(15)=15 → 12
  });
});

describe('getEntangledMatches: 얽힌 경기 페이징 + 양 팀 전체 로스터', () => {
  // g1 vs: [PA,PC] vs [PB,PD] 1팀 승 / g2 A만 참여(제외) / g3 같은팀 [PA,PB] 2팀 승(패배) / g4 옛 포맷 vs 2팀 승
  const fixtures = () => [
    m([p('PA'), p('PC', 480, 'TOP')], [p('PB'), p('PD')], 1, '2025-01-01T00:00:00Z'),
    m([p('PA'), p('PC')], [p('PD'), p('PE')], 1, '2025-01-02T00:00:00Z'),
    m([p('PA'), p('PB')], [p('PC'), p('PD')], 2, '2025-01-03T00:00:00Z'),
    m([pOld('PA'), pOld('PD')], [pOld('PB'), pOld('PE')], 2, '2025-01-04T00:00:00Z'),
  ];
  const setupUsers = () => {
    mockModels.user.findAll.mockResolvedValue([userRow('PA', 0, 0, 500, 0), userRow('PB', 0, 0, 500, 0)]);
    mockModels.match.findAll.mockResolvedValue(fixtures());
  };

  test('얽힌 경기만 최신순으로, 로스터·승패 플래그·이름 폴백', async () => {
    setupUsers();
    mockModels.summoner.findAll.mockResolvedValue([{ puuid: 'PA', name: 'CurrentA' }]);

    const { status, result } = await compareController.getEntangledMatches(1, 'PA', 'PB');
    expect(status).toBe(200);
    expect(result.total).toBe(3);
    expect(result.page).toBe(0);
    expect(result.size).toBe(20);
    expect(result.items.map((i) => i.gameId)).toEqual([4, 3, 1]);

    // g3: 같은팀 패배 → aWon/bWon 모두 false, 2팀이 won
    const g3 = result.items[1];
    expect(g3).toMatchObject({ sameTeam: true, winTeam: 2, aWon: false, bWon: false });
    expect(g3.teams[0]).toMatchObject({ teamNo: 1, won: false });
    expect(g3.teams[1]).toMatchObject({ teamNo: 2, won: true });
    // 현재 summoner 이름 우선, 없으면 스냅샷 name 폴백 + isA/isB 플래그
    expect(g3.teams[0].players[0]).toEqual({
      puuid: 'PA',
      name: 'CurrentA',
      position: null,
      rating: 500,
      isA: true,
      isB: false,
    });
    expect(g3.teams[0].players[1]).toMatchObject({ puuid: 'PB', name: 'n-PB', isA: false, isB: true });

    // g4(옛 포맷): rating/position null
    const g4 = result.items[0];
    expect(g4).toMatchObject({ sameTeam: false, winTeam: 2, aWon: false, bWon: true });
    expect(g4.teams[0].players[1]).toEqual({
      puuid: 'PD',
      name: 'n-PD',
      position: null,
      rating: null,
      isA: false,
      isB: false,
    });

    // g1: 포지션 스냅샷 있는 플레이어는 그대로
    const g1 = result.items[2];
    expect(g1.teams[0].players[1]).toMatchObject({ puuid: 'PC', position: 'TOP', rating: 480 });
  });

  test('page/size 슬라이스와 클램프, NaN이면 기본값', async () => {
    setupUsers();

    const page1 = await compareController.getEntangledMatches(1, 'PA', 'PB', 1, 2);
    expect(page1.result).toMatchObject({ total: 3, page: 1, size: 2 });
    expect(page1.result.items.map((i) => i.gameId)).toEqual([1]);

    const clamped = await compareController.getEntangledMatches(1, 'PA', 'PB', -5, 999);
    expect(clamped.result).toMatchObject({ page: 0, size: 50 });
    expect(clamped.result.items).toHaveLength(3);

    const defaulted = await compareController.getEntangledMatches(1, 'PA', 'PB', NaN, NaN);
    expect(defaulted.result).toMatchObject({ page: 0, size: 20 });
  });

  test('400: 파라미터 누락 또는 동일 puuid (DB 호출 전 차단)', async () => {
    const missing = await compareController.getEntangledMatches(NaN, 'PA', 'PB');
    expect(missing.status).toBe(400);
    const same = await compareController.getEntangledMatches(1, 'PA', 'PA');
    expect(same.status).toBe(400);
    expect(mockModels.user.findAll).not.toHaveBeenCalled();
  });

  test('404: 한 명이라도 그룹에 없음', async () => {
    mockModels.user.findAll.mockResolvedValue([userRow('PA', 0, 0, 500, 0)]);
    mockModels.match.findAll.mockResolvedValue([]);
    const r = await compareController.getEntangledMatches(1, 'PA', 'PB');
    expect(r.status).toBe(404);
  });
});
