/**
 * 챌린지 컨트롤러 단위 테스트
 * DB/Riot API 의존성을 모킹하여 비즈니스 로직 검증
 */

// --- 모킹 설정 ---

jest.mock('sequelize', () => ({
  Op: {
    in: Symbol('in'),
    gte: Symbol('gte'),
    lte: Symbol('lte'),
    or: Symbol('or'),
  },
}));

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
  summoner: {
    findAll: jest.fn(),
  },
  sequelize: {
    fn: jest.fn(() => 'COUNT_FN'),
    col: jest.fn(() => 'COL'),
  },
};

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
    delete mockChallenge.toJSON.toJSON; // prevent recursion in spread
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
    expect(mockModels.challenge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 1,
        title: '테스트 챌린지',
        gameType: 'soloRank',
        createdBy: 'puuid-creator',
      }),
    );
  });
});

// --- 챌린지 취소 ---

describe('cancelChallenge', () => {
  test('챌린지가 없으면 404 반환', async () => {
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

// --- 참가 ---

describe('joinChallenge', () => {
  test('챌린지가 없으면 404', async () => {
    mockModels.challenge.findByPk.mockResolvedValue(null);
    const result = await challengeController.joinChallenge(999, 'puuid-1');
    expect(result.status).toBe(404);
  });

  test('ended 챌린지에는 참가 불가', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, canceledAt: null,
      startAt: new Date('2020-01-01'), endAt: new Date('2020-12-31'),
    });
    const result = await challengeController.joinChallenge(1, 'puuid-1');
    expect(result.status).toBe(400);
  });

  test('canceled 챌린지에는 참가 불가', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, canceledAt: new Date(),
      startAt: new Date('2020-01-01'), endAt: new Date('2099-12-31'),
    });
    const result = await challengeController.joinChallenge(1, 'puuid-1');
    expect(result.status).toBe(400);
  });

  test('이미 참가한 경우 400', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, canceledAt: null,
      startAt: new Date('2020-01-01'), endAt: new Date('2099-12-31'),
    });
    mockModels.challenge_participant.findOne.mockResolvedValue({ id: 1 });

    const result = await challengeController.joinChallenge(1, 'puuid-1');
    expect(result.status).toBe(400);
    expect(result.result).toContain('이미');
  });

  test('정상 참가 시 200', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, canceledAt: null,
      startAt: new Date('2020-01-01'), endAt: new Date('2099-12-31'),
    });
    mockModels.challenge_participant.findOne.mockResolvedValue(null);
    const mockParticipant = { id: 1, challengeId: 1, puuid: 'puuid-1' };
    mockModels.challenge_participant.create.mockResolvedValue(mockParticipant);

    const result = await challengeController.joinChallenge(1, 'puuid-1');
    expect(result.status).toBe(200);
    expect(result.result).toEqual(mockParticipant);
  });
});

// --- 참가 취소 ---

describe('cancelJoin', () => {
  test('ended 상태 챌린지에서는 취소 불가', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, canceledAt: null,
      startAt: new Date('2020-01-01'), endAt: new Date('2020-12-31'),
    });
    const result = await challengeController.cancelJoin(1, 'puuid-1');
    expect(result.status).toBe(400);
  });

  test('참가하지 않은 경우 400', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, canceledAt: null,
      startAt: new Date('2020-01-01'), endAt: new Date('2099-12-31'),
    });
    mockModels.challenge_participant.findOne.mockResolvedValue(null);

    const result = await challengeController.cancelJoin(1, 'puuid-1');
    expect(result.status).toBe(400);
    expect(result.result).toContain('참가하지 않은');
  });

  test('정상 취소 시 200', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, canceledAt: null,
      startAt: new Date('2020-01-01'), endAt: new Date('2099-12-31'),
    });
    mockModels.challenge_participant.findOne.mockResolvedValue({
      id: 1, destroy: jest.fn(),
    });

    const result = await challengeController.cancelJoin(1, 'puuid-1');
    expect(result.status).toBe(200);
  });
});

// --- 리더보드 ---

describe('getLeaderboard', () => {
  test('챌린지가 없으면 404', async () => {
    mockModels.challenge.findByPk.mockResolvedValue(null);
    const result = await challengeController.getLeaderboard(999);
    expect(result.status).toBe(404);
  });

  test('참가자가 없으면 빈 배열 반환', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, gameType: 'soloRank', startAt: new Date('2026-04-01'), endAt: new Date('2026-04-30'),
    });
    mockModels.challenge_participant.findAll.mockResolvedValue([]);

    const result = await challengeController.getLeaderboard(1);
    expect(result.status).toBe(200);
    expect(result.result).toEqual([]);
  });

  test('리더보드 정렬: points > wins > winRate > totalGames', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, gameType: 'soloRank',
      startAt: new Date('2026-04-01'), endAt: new Date('2026-04-30'),
    });

    mockModels.challenge_participant.findAll.mockResolvedValue([
      { puuid: 'a' },
      { puuid: 'b' },
      { puuid: 'c' },
    ]);

    // a: 5승 5패 (10판, points=10), b: 7승 3패 (10판, points=10), c: 3승 0패 (3판, points=3)
    mockModels.challenge_match.findAll.mockResolvedValue([
      ...Array(5).fill(null).map((_, i) => ({ puuid: 'a', win: true, gameCreation: new Date(`2026-04-${i + 1}`) })),
      ...Array(5).fill(null).map((_, i) => ({ puuid: 'a', win: false, gameCreation: new Date(`2026-04-${i + 6}`) })),
      ...Array(7).fill(null).map((_, i) => ({ puuid: 'b', win: true, gameCreation: new Date(`2026-04-${i + 1}`) })),
      ...Array(3).fill(null).map((_, i) => ({ puuid: 'b', win: false, gameCreation: new Date(`2026-04-${i + 8}`) })),
      ...Array(3).fill(null).map((_, i) => ({ puuid: 'c', win: true, gameCreation: new Date(`2026-04-${i + 1}`) })),
    ]);

    mockModels.summoner.findAll.mockResolvedValue([
      { puuid: 'a', name: 'PlayerA' },
      { puuid: 'b', name: 'PlayerB' },
      { puuid: 'c', name: 'PlayerC' },
    ]);

    const result = await challengeController.getLeaderboard(1);
    expect(result.status).toBe(200);

    const board = result.result;
    expect(board[0].puuid).toBe('b');
    expect(board[0].rank).toBe(1);
    expect(board[1].puuid).toBe('a');
    expect(board[1].rank).toBe(2);
    expect(board[2].puuid).toBe('c');
    expect(board[2].rank).toBe(3);
    expect(board[2].points).toBe(3);
  });

  test('streak 계산 검증', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, gameType: 'soloRank',
      startAt: new Date('2026-04-01'), endAt: new Date('2026-04-30'),
    });

    mockModels.challenge_participant.findAll.mockResolvedValue([{ puuid: 'x' }]);

    // 승승승패패승 → bestWinStreak=3, bestLoseStreak=2, currentWinStreak=1, currentLoseStreak=0
    mockModels.challenge_match.findAll.mockResolvedValue([
      { puuid: 'x', win: true, gameCreation: new Date('2026-04-01') },
      { puuid: 'x', win: true, gameCreation: new Date('2026-04-02') },
      { puuid: 'x', win: true, gameCreation: new Date('2026-04-03') },
      { puuid: 'x', win: false, gameCreation: new Date('2026-04-04') },
      { puuid: 'x', win: false, gameCreation: new Date('2026-04-05') },
      { puuid: 'x', win: true, gameCreation: new Date('2026-04-06') },
    ]);

    mockModels.summoner.findAll.mockResolvedValue([{ puuid: 'x', name: 'StreakPlayer' }]);

    const result = await challengeController.getLeaderboard(1);
    const entry = result.result[0];

    expect(entry.bestWinStreak).toBe(3);
    expect(entry.bestLoseStreak).toBe(2);
    expect(entry.currentWinStreak).toBe(1);
    expect(entry.currentLoseStreak).toBe(0);
    expect(entry.winRate).toBe(66.7);
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
      lastSyncAt: new Date(), // 방금 동기화
    });

    const result = await challengeController.syncChallengeMatches(1);
    expect(result.status).toBe(429);
  });

  test('참가자가 없으면 synced 0 반환', async () => {
    mockModels.challenge.findByPk.mockResolvedValue({
      id: 1, gameType: 'soloRank', lastSyncAt: null,
      startAt: new Date('2026-04-01'), endAt: new Date('2026-04-30'),
    });
    mockModels.challenge_participant.findAll.mockResolvedValue([]);

    const result = await challengeController.syncChallengeMatches(1);
    expect(result.status).toBe(200);
    expect(result.result.synced).toBe(0);
  });
});
