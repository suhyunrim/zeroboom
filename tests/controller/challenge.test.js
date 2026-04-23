/**
 * 챌린지 컨트롤러 단위 테스트
 * DB/Riot API 의존성을 모킹하여 비즈니스 로직 검증
 */

// --- 모킹 설정 ---

const mockModels = {
  group: { findByPk: jest.fn() },
  challenge: {
    create: jest.fn(),
    findByPk: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
  },
  challenge_participant: {
    create: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    count: jest.fn(),
  },
  challenge_match: {
    findAll: jest.fn(),
    findOrCreate: jest.fn(),
  },
  challenge_match_detail: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findOrCreate: jest.fn(),
  },
  summoner: {
    findAll: jest.fn(),
  },
  user: {
    findAll: jest.fn(),
  },
  sequelize: {
    fn: jest.fn(() => 'COUNT_FN'),
    col: jest.fn(() => 'COL'),
    escape: jest.fn((v) => `'${v}'`),
    literal: jest.fn((v) => v),
    query: jest.fn(),
  },
};

jest.mock('sequelize', () => ({
  Op: {
    in: Symbol('in'),
    gte: Symbol('gte'),
    lte: Symbol('lte'),
    or: Symbol('or'),
    ne: Symbol('ne'),
  },
  QueryTypes: { SELECT: 'SELECT' },
}));

jest.mock('../../src/db/models', () => mockModels);
jest.mock('../../src/loaders/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock('../../src/services/riot-api', () => ({
  getMatchIdsFromPuuid: jest.fn(),
  getMatchData: jest.fn(),
}));

const challengeController = require('../../src/controller/challenge');

beforeEach(() => {
  jest.clearAllMocks();
});

// --- 상태 자동 계산 ---

describe('getChallengeStatus', () => {
  test('canceledAt이 있으면 canceled', () => {
    const result = challengeController.getChallengeStatus({
      canceledAt: new Date(),
      startAt: new Date('2020-01-01'),
      endAt: new Date('2099-12-31'),
    });
    expect(result).toBe('canceled');
  });

  test('현재 시각이 startAt 이전이면 scheduled', () => {
    const result = challengeController.getChallengeStatus({
      canceledAt: null,
      startAt: new Date('2099-01-01'),
      endAt: new Date('2099-12-31'),
    });
    expect(result).toBe('scheduled');
  });

  test('현재 시각이 startAt~endAt 사이면 active', () => {
    const result = challengeController.getChallengeStatus({
      canceledAt: null,
      startAt: new Date('2020-01-01'),
      endAt: new Date('2099-12-31'),
    });
    expect(result).toBe('active');
  });

  test('현재 시각이 endAt 이후면 ended', () => {
    const result = challengeController.getChallengeStatus({
      canceledAt: null,
      startAt: new Date('2020-01-01'),
      endAt: new Date('2020-12-31'),
    });
    expect(result).toBe('ended');
  });
});

// --- 챌린지 생성 ---

describe('createChallenge', () => {
  test('그룹이 없으면 404 반환', async () => {
    mockModels.group.findByPk.mockResolvedValue(null);

    const result = await challengeController.createChallenge(999, {
      title: '테스트', gameType: 'soloRank', startAt: '2026-04-01', endAt: '2026-04-30',
    }, 'puuid-1');

    expect(result.status).toBe(404);
  });

  test('정상 생성 시 200 반환', async () => {
    mockModels.group.findByPk.mockResolvedValue({ id: 1 });
    const mockChallenge = {
      id: 1, title: '테스트 챌린지', canceledAt: null,
      startAt: new Date('2099-01-01'), endAt: new Date('2099-12-31'),
      toJSON() { return { ...this }; },
    };
    mockModels.challenge.create.mockResolvedValue(mockChallenge);

    const result = await challengeController.createChallenge(1, {
      title: '테스트 챌린지',
      gameType: 'soloRank',
      startAt: '2099-01-01',
      endAt: '2099-12-31',
      scoringType: 'points',
    }, 'puuid-creator');

    expect(result.status).toBe(200);
    expect(result.result.status).toBe('scheduled');
  });
});

// --- 챌린지 취소 ---

describe('cancelChallenge', () => {
  test('챌린지가 없으면 404', async () => {
    mockModels.challenge.findByPk.mockResolvedValue(null);
    const result = await challengeController.cancelChallenge(999);
    expect(result.status).toBe(404);
  });

  test('이미 취소된 경우 400', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({ id: 1, canceledAt: new Date() });
    const result = await challengeController.cancelChallenge(1);
    expect(result.status).toBe(400);
  });

  test('정상 취소 시 200', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({ id: 1, canceledAt: null });
    mockModels.challenge.update.mockResolvedValue([1]);
    const result = await challengeController.cancelChallenge(1);
    expect(result.status).toBe(200);
    expect(result.result.status).toBe('canceled');
  });
});

// --- 리더보드 ---

describe('getLeaderboard', () => {
  test('챌린지가 없으면 404', async () => {
    mockModels.challenge.findByPk.mockResolvedValue(null);
    const result = await challengeController.getLeaderboard(999);
    expect(result.status).toBe(404);
  });

  test('ended + 스냅샷 있으면 스냅샷 반환', async () => {
    const snapshot = [{ puuid: 'a', rank: 1, wins: 5 }];
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, groupId: 1, gameType: 'soloRank', canceledAt: null,
      startAt: new Date('2020-01-01'), endAt: new Date('2020-12-31'),
      leaderboardSnapshot: snapshot,
    });
    const result = await challengeController.getLeaderboard(1);
    expect(result.status).toBe(200);
    expect(result.result).toBe(snapshot);
  });

  test('그룹 유저가 없으면 빈 배열', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, groupId: 1, gameType: 'soloRank', startAt: new Date('2026-04-01'), endAt: new Date('2026-04-30'),
    });
    // 첫 번째 user.findAll: 그룹 유저 조회 → 빈 배열
    mockModels.user.findAll.mockResolvedValueOnce([]);
    const result = await challengeController.getLeaderboard(1);
    expect(result.status).toBe(200);
    expect(result.result).toEqual([]);
  });

  test('리더보드 정렬: points > wins > winRate > totalGames', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, groupId: 1, gameType: 'soloRank',
      startAt: new Date('2026-04-01'), endAt: new Date('2026-04-30'),
    });
    // 첫 번째 user.findAll: 그룹 유저 조회 (4명 — c의 파트너로 d 포함)
    mockModels.user.findAll.mockResolvedValueOnce([
      { puuid: 'a' }, { puuid: 'b' }, { puuid: 'c' }, { puuid: 'd' },
    ]);

    // 두 번째 user.findAll: 부캐 조회 → 없음
    mockModels.user.findAll.mockResolvedValueOnce([]);

    // sequelize.query: challenge_matches JOIN challenge_match_details 결과
    // 각 matchId마다 distinct puuid ≥ 2여야 필터 통과
    // 목표: a 5W 5L, b 7W 3L, c 3W 0L
    // 구성:
    //   - (a,b) 같은팀 승 5게임: m_sw0..4 — a W, b W
    //   - (a,b) 같은팀 패 3게임: m_sl0..2 — a L, b L
    //   - (a,b) 다른팀(b 승): m_bw0..1 — a L, b W
    //   - (c,d) 같은팀 승 3게임: m_cd0..2 — c W, d W (d는 미검증)
    const day = (n) => new Date(`2026-04-${String(n).padStart(2, '0')}`);
    const joinedRows = [
      ...Array(5).fill(null).flatMap((_, i) => [
        { matchId: `m_sw${i}`, puuid: 'a', win: 1, gameCreation: day(i + 1) },
        { matchId: `m_sw${i}`, puuid: 'b', win: 1, gameCreation: day(i + 1) },
      ]),
      ...Array(3).fill(null).flatMap((_, i) => [
        { matchId: `m_sl${i}`, puuid: 'a', win: 0, gameCreation: day(i + 6) },
        { matchId: `m_sl${i}`, puuid: 'b', win: 0, gameCreation: day(i + 6) },
      ]),
      ...Array(2).fill(null).flatMap((_, i) => [
        { matchId: `m_bw${i}`, puuid: 'a', win: 0, gameCreation: day(i + 9) },
        { matchId: `m_bw${i}`, puuid: 'b', win: 1, gameCreation: day(i + 9) },
      ]),
      ...Array(3).fill(null).flatMap((_, i) => [
        { matchId: `m_cd${i}`, puuid: 'c', win: 1, gameCreation: day(i + 11) },
        { matchId: `m_cd${i}`, puuid: 'd', win: 1, gameCreation: day(i + 11) },
      ]),
    ];
    mockModels.sequelize.query.mockResolvedValue(joinedRows);

    mockModels.summoner.findAll.mockResolvedValue([
      { puuid: 'a', name: 'PlayerA' },
      { puuid: 'b', name: 'PlayerB' },
      { puuid: 'c', name: 'PlayerC' },
      { puuid: 'd', name: 'PlayerD' },
    ]);

    const result = await challengeController.getLeaderboard(1);
    expect(result.status).toBe(200);
    const board = result.result;
    const byPuuid = Object.fromEntries(board.map((e) => [e.puuid, e]));

    // a: 5W 5L, b: 7W 3L, c: 3W 0L
    expect(byPuuid.a).toMatchObject({ wins: 5, losses: 5, points: 10 });
    expect(byPuuid.b).toMatchObject({ wins: 7, losses: 3, points: 10 });
    expect(byPuuid.c).toMatchObject({ wins: 3, losses: 0, points: 3 });

    // a,b 모두 10 points, b가 wins 더 많음 → b 1등
    expect(byPuuid.b.rank).toBe(1);
    expect(byPuuid.a.rank).toBe(2);
    // c는 points가 낮아 b,a 다음
    expect(byPuuid.c.rank).toBeGreaterThan(2);
  });
});

// --- 유저 전적 상세 ---

describe('getUserMatchHistory', () => {
  test('챌린지가 없으면 404', async () => {
    mockModels.challenge.findByPk.mockResolvedValue(null);
    const result = await challengeController.getUserMatchHistory(999, 'puuid-1', 1);
    expect(result.status).toBe(404);
  });

  test('그룹 멤버 식별 + participants 전체 내려줌', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, gameType: 'soloRank',
      startAt: new Date('2026-04-01'), endAt: new Date('2026-04-30'),
    });

    mockModels.challenge_match.findAll.mockResolvedValue([
      { matchId: 'KR_123', puuid: 'me', win: true },
    ]);

    const participants = [
      { puuid: 'me', championName: 'Jinx', teamId: 100, win: true, kills: 10, deaths: 2, assists: 8 },
      { puuid: 'friend1', championName: 'Thresh', teamId: 100, win: true, kills: 1, deaths: 3, assists: 15 },
      { puuid: 'stranger', championName: 'Zed', teamId: 200, win: false, kills: 5, deaths: 7, assists: 3 },
    ];

    mockModels.challenge_match_detail.findAll.mockResolvedValue([{
      matchId: 'KR_123',
      gameCreation: new Date('2026-04-05'),
      participants,
    }]);

    // 첫 번째 user.findAll: 부캐 조회 → 없음
    mockModels.user.findAll.mockResolvedValueOnce([]);
    // 두 번째 user.findAll: 그룹 멤버 조회
    mockModels.user.findAll.mockResolvedValueOnce([{ puuid: 'me' }, { puuid: 'friend1' }]);
    mockModels.summoner.findAll.mockResolvedValue([
      { puuid: 'me', name: 'MyName' },
      { puuid: 'friend1', name: 'FriendOne' },
    ]);

    const result = await challengeController.getUserMatchHistory(1, 'me', 1);
    expect(result.status).toBe(200);
    expect(result.result).toHaveLength(1);

    const match = result.result[0];
    // participants 전체가 내려옴
    expect(match.participants).toHaveLength(3);
    // 그룹 멤버 (본인 제외)
    expect(match.groupMembers).toHaveLength(1);
    expect(match.groupMembers[0].name).toBe('FriendOne');
    expect(match.groupMembers[0].sameTeam).toBe(true);
  });
});

// --- 챌린지 전적 갱신 ---

describe('syncChallengeMatches', () => {
  test('챌린지가 없으면 404', async () => {
    mockModels.challenge.findByPk.mockResolvedValue(null);
    const result = await challengeController.syncChallengeMatches(999);
    expect(result.status).toBe(404);
  });

  test('쿨다운 중이면 429', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, gameType: 'soloRank',
      lastSyncAt: new Date(),
    });
    const result = await challengeController.syncChallengeMatches(1);
    expect(result.status).toBe(429);
  });

  test('그룹 유저가 없으면 synced 0', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, groupId: 1, gameType: 'soloRank', lastSyncAt: null,
      startAt: new Date('2026-04-01'), endAt: new Date('2026-04-30'),
    });
    // 그룹 유저 없음
    mockModels.user.findAll.mockResolvedValueOnce([]);
    const result = await challengeController.syncChallengeMatches(1);
    expect(result.status).toBe(200);
    expect(result.result.synced).toBe(0);
  });

  test('그룹 유저가 있으면 202 즉시 반환', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 99, groupId: 1, gameType: 'soloRank', lastSyncAt: null,
      startAt: new Date('2026-04-01'), endAt: new Date('2026-04-30'),
    });
    // 그룹 유저 + 부캐 조회 (syncChallengeMatches + runSyncInBackground 양쪽)
    mockModels.user.findAll
      .mockResolvedValueOnce([{ puuid: 'puuid-1' }, { puuid: 'puuid-2' }]) // 그룹 유저
      .mockResolvedValueOnce([]) // 부캐 조회 (syncChallengeMatches)
      .mockResolvedValue([]); // 부캐 조회 (runSyncInBackground)

    const result = await challengeController.syncChallengeMatches(99);
    expect(result.status).toBe(202);
    expect(result.result.total).toBe(2);
  });

  test('부캐 있으면 total에 포함', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 100, groupId: 1, gameType: 'soloRank', lastSyncAt: null,
      startAt: new Date('2026-04-01'), endAt: new Date('2026-04-30'),
    });
    // 그룹 유저 + 부캐 조회 (syncChallengeMatches + runSyncInBackground 양쪽)
    mockModels.user.findAll
      .mockResolvedValueOnce([{ puuid: 'main-1' }, { puuid: 'main-2' }]) // 그룹 유저
      .mockResolvedValueOnce([{ puuid: 'sub-1', primaryPuuid: 'main-1' }]) // 부캐 (syncChallengeMatches)
      .mockResolvedValue([{ puuid: 'sub-1', primaryPuuid: 'main-1' }]); // 부캐 (runSyncInBackground)

    const result = await challengeController.syncChallengeMatches(100);
    expect(result.status).toBe(202);
    expect(result.result.total).toBe(3); // main-1 + main-2 + sub-1
  });
});

// --- 동기화 상태 조회 ---

describe('getSyncStatus', () => {
  test('동기화 중이 아니면 idle', () => {
    const result = challengeController.getSyncStatus(999);
    expect(result.status).toBe(200);
    expect(result.result.syncStatus).toBe('idle');
    expect(result.result.syncProgress).toBeNull();
  });
});
