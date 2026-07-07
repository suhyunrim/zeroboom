const mockModels = {
  group: { findByPk: jest.fn(), findOne: jest.fn() },
  match: { findAll: jest.fn() },
  user: { findAll: jest.fn(), findOne: jest.fn() },
  summoner: { findAll: jest.fn() },
  externalRecord: { findAll: jest.fn() },
};

jest.mock('../../src/db/models', () => mockModels);
jest.mock('../../src/loaders/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const groupController = require('../../src/controller/group');

// 저장 포맷 [puuid, name, rating, position]
const player = (puuid, rating = 500, position = null) => [puuid, `${puuid}#KR1`, rating, position];
const match = (team1, team2, winTeam) => ({ team1, team2, winTeam });

// 1v1, 양팀 레이팅 500 동일 → 승리 +8 / 패배 -8 (K=16)
const makeSeries = (winCounts) => {
  const matches = [];
  for (let i = 0; i < winCounts.aWins; i++) {
    matches.push(match([player('A', 500, 'TOP')], [player('B', 500, 'JUNGLE')], 1));
  }
  for (let i = 0; i < winCounts.bWins; i++) {
    matches.push(match([player('A', 500, 'TOP')], [player('B', 500, 'JUNGLE')], 2));
  }
  return matches;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockModels.group.findByPk.mockResolvedValue({ id: 1 });
  mockModels.user.findAll.mockResolvedValue([{ puuid: 'A' }, { puuid: 'B' }]);
  mockModels.summoner.findAll.mockResolvedValue([
    { puuid: 'A', name: '에이' },
    { puuid: 'B', name: '비' },
  ]);
});

describe('getPositionRanking', () => {
  test('그룹이 없으면 404', async () => {
    mockModels.group.findByPk.mockResolvedValue(null);
    const r = await groupController.getPositionRanking(999);
    expect(r.status).toBe(404);
  });

  test('포지션별 득실 누적·승패 집계·랭킹 부여', async () => {
    mockModels.match.findAll.mockResolvedValue(makeSeries({ aWins: 5, bWins: 1 }));

    const r = await groupController.getPositionRanking(1);
    expect(r.status).toBe(200);

    expect(r.result.TOP).toEqual([
      {
        puuid: 'A',
        name: '에이',
        win: 5,
        lose: 1,
        games: 6,
        winRate: 83,
        ratingChange: 32,
        ranking: 1,
      },
    ]);
    expect(r.result.JUNGLE).toEqual([
      {
        puuid: 'B',
        name: '비',
        win: 1,
        lose: 5,
        games: 6,
        winRate: 17,
        ratingChange: -32,
        ranking: 1,
      },
    ]);
    expect(r.result.MIDDLE).toEqual([]);
    expect(r.result.BOTTOM).toEqual([]);
    expect(r.result.UTILITY).toEqual([]);
  });

  test('같은 포지션은 득실 내림차순으로 정렬', async () => {
    // A 3승1패(+16), C 4승0패(+32) — 모두 TOP 5판 이상 채우도록 구성
    const matches = [
      ...Array.from({ length: 4 }, () => match([player('A', 500, 'TOP')], [player('B', 500, 'JUNGLE')], 1)),
      match([player('A', 500, 'TOP')], [player('B', 500, 'JUNGLE')], 2),
      ...Array.from({ length: 5 }, () => match([player('C', 500, 'TOP')], [player('B', 500, 'JUNGLE')], 1)),
    ];
    mockModels.match.findAll.mockResolvedValue(matches);
    mockModels.user.findAll.mockResolvedValue([{ puuid: 'A' }, { puuid: 'B' }, { puuid: 'C' }]);
    mockModels.summoner.findAll.mockResolvedValue([
      { puuid: 'A', name: '에이' },
      { puuid: 'B', name: '비' },
      { puuid: 'C', name: '씨' },
    ]);

    const r = await groupController.getPositionRanking(1);
    expect(r.result.TOP.map((e) => e.puuid)).toEqual(['C', 'A']);
    expect(r.result.TOP[0]).toMatchObject({ ranking: 1, ratingChange: 40 });
    expect(r.result.TOP[1]).toMatchObject({ ranking: 2, ratingChange: 24 });
  });

  test('포지션 5판 미만은 랭킹에서 제외, myRanking에 사유 표시', async () => {
    mockModels.match.findAll.mockResolvedValue(makeSeries({ aWins: 4, bWins: 0 }));

    const r = await groupController.getPositionRanking(1, 'A');
    expect(r.result.TOP).toEqual([]);
    expect(r.myRanking.TOP).toMatchObject({
      puuid: 'A',
      ranking: null,
      win: 4,
      lose: 0,
      ratingChange: 32,
      reason: '5판 미만',
    });
    // eligible 유저는 역할 재조회 불필요
    expect(mockModels.user.findOne).not.toHaveBeenCalled();
  });

  test('랭킹 포함 유저의 myRanking은 reason null + 순위 포함', async () => {
    mockModels.match.findAll.mockResolvedValue(makeSeries({ aWins: 5, bWins: 1 }));

    const r = await groupController.getPositionRanking(1, 'A');
    expect(r.myRanking.TOP).toMatchObject({ puuid: 'A', ranking: 1, reason: null });
    expect(r.myRanking.JUNGLE).toBeUndefined();
  });

  test('outsider는 랭킹 제외, 본인 조회 시 블랙리스트 사유', async () => {
    mockModels.match.findAll.mockResolvedValue(makeSeries({ aWins: 1, bWins: 5 }));
    mockModels.user.findAll.mockResolvedValue([{ puuid: 'A' }]); // B는 outsider
    mockModels.user.findOne.mockResolvedValue({ puuid: 'B', role: 'outsider' });

    const r = await groupController.getPositionRanking(1, 'B');
    expect(r.result.JUNGLE).toEqual([]);
    expect(r.myRanking.JUNGLE).toMatchObject({ ranking: null, reason: '블랙리스트' });
  });

  test('전원 포지션이 기록된 매치만 집계 (구형·부분 기록 매치는 스킵)', async () => {
    const matches = [
      // 구형 포맷 [puuid, name] — 매치 전체 스킵
      match([['A', 'A#KR1']], [['B', 'B#KR1']], 1),
      // 부분 기록 (B 포지션 null) — 매치 전체 스킵
      match([player('A', 500, 'TOP')], [player('B', 500, null)], 1),
      // 전원 기록 — 집계
      ...Array.from({ length: 5 }, () => match([player('A', 500, 'TOP')], [player('B', 500, 'JUNGLE')], 1)),
    ];
    mockModels.match.findAll.mockResolvedValue(matches);

    const r = await groupController.getPositionRanking(1);
    expect(r.result.TOP).toHaveLength(1);
    expect(r.result.TOP[0]).toMatchObject({ puuid: 'A', games: 5, ratingChange: 40 });
    expect(r.result.JUNGLE).toHaveLength(1);
    expect(r.result.JUNGLE[0]).toMatchObject({ puuid: 'B', games: 5, ratingChange: -40 });
    expect(r.myRanking).toBeUndefined();
  });
});
