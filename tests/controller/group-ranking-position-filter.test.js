const mockModels = {
  group: { findOne: jest.fn() },
  match: { findAll: jest.fn() },
  user: { findAll: jest.fn() },
  summoner: { findAll: jest.fn() },
  externalRecord: { findAll: jest.fn() },
};

jest.mock('../../src/db/models', () => mockModels);
jest.mock('../../src/loaders/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const groupController = require('../../src/controller/group');

// 저장 포맷 [puuid, name, rating, position]
const player = (puuid, position = null) => [puuid, `${puuid}#KR1`, 500, position];
const match = (team1, team2, winTeam) => ({ team1, team2, winTeam });

const makeUser = (puuid, rating, win = 10, lose = 10) => {
  const data = { puuid, defaultRating: rating, additionalRating: 0, win, lose };
  return { ...data, dataValues: data };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockModels.group.findOne.mockResolvedValue({ id: 1 });
  mockModels.externalRecord.findAll.mockResolvedValue([]);
  mockModels.user.findAll.mockResolvedValue([makeUser('A', 900), makeUser('B', 700), makeUser('C', 1000)]);
  mockModels.summoner.findAll.mockResolvedValue([
    { puuid: 'A', name: '에이' },
    { puuid: 'B', name: '비' },
    { puuid: 'C', name: '씨' },
  ]);
});

describe('getRanking - 포지션 필터', () => {
  test('해당 포지션 5판 이상 유저만 레이팅순으로 노출, 포지션 전적 포함', async () => {
    mockModels.match.findAll.mockResolvedValue([
      // A: TOP 3승 2패
      ...Array.from({ length: 3 }, () => match([player('A', 'TOP')], [player('D', 'JUNGLE')], 1)),
      ...Array.from({ length: 2 }, () => match([player('A', 'TOP')], [player('D', 'JUNGLE')], 2)),
      // B: TOP 6승
      ...Array.from({ length: 6 }, () => match([player('B', 'TOP')], [player('D', 'JUNGLE')], 1)),
      // C: TOP 3승 (5판 미만 → 제외)
      ...Array.from({ length: 3 }, () => match([player('C', 'TOP')], [player('D', 'JUNGLE')], 1)),
    ]);

    const r = await groupController.getRanking('그룹', 'TOP');
    expect(r.status).toBe(200);

    // C는 레이팅 1000이지만 TOP 3판이라 제외, 정렬은 레이팅 내림차순 유지
    expect(r.result.map((e) => e.puuid)).toEqual(['A', 'B']);
    expect(r.result[0]).toEqual({
      puuid: 'A',
      ranking: 1,
      name: '에이',
      rating: 900,
      win: 10,
      lose: 10,
      winRate: 50,
      positionWin: 3,
      positionLose: 2,
      positionGames: 5,
      positionWinRate: 60,
    });
    expect(r.result[1]).toMatchObject({
      puuid: 'B',
      ranking: 2,
      rating: 700,
      positionWin: 6,
      positionLose: 0,
      positionGames: 6,
      positionWinRate: 100,
    });
  });

  test('다른 포지션 판수는 필터에 포함되지 않음', async () => {
    mockModels.match.findAll.mockResolvedValue([
      // A: TOP 3판 + JUNGLE 4판 → TOP 필터에서는 3판이라 제외
      ...Array.from({ length: 3 }, () => match([player('A', 'TOP')], [player('D', 'JUNGLE')], 1)),
      ...Array.from({ length: 4 }, () => match([player('A', 'JUNGLE')], [player('D', 'TOP')], 1)),
    ]);

    const r = await groupController.getRanking('그룹', 'TOP');
    expect(r.result).toEqual([]);
  });

  test('포지션 미기록 매치(구형·부분 기록)는 집계되지 않음', async () => {
    mockModels.match.findAll.mockResolvedValue([
      // 구형 포맷 [puuid, name]
      ...Array.from({ length: 3 }, () => match([['A', 'A#KR1']], [['D', 'D#KR1']], 1)),
      // 포지션 null
      ...Array.from({ length: 3 }, () => match([player('A', null)], [player('D', 'JUNGLE')], 1)),
      // 정상 기록 3판 → 합쳐도 5판 미만
      ...Array.from({ length: 3 }, () => match([player('A', 'TOP')], [player('D', 'JUNGLE')], 1)),
    ]);

    const r = await groupController.getRanking('그룹', 'TOP');
    expect(r.result).toEqual([]);
  });

  test('position 미지정 시 기존 동작 (매치 조회 없음, 포지션 필드 없음)', async () => {
    mockModels.user.findAll.mockResolvedValue([
      makeUser('A', 900, 3, 1), // 총 4판 → 컷 미달
      makeUser('B', 700, 10, 10),
    ]);
    mockModels.summoner.findAll.mockResolvedValue([{ puuid: 'B', name: '비' }]);

    const r = await groupController.getRanking('그룹');
    expect(mockModels.match.findAll).not.toHaveBeenCalled();
    expect(r.result.map((e) => e.puuid)).toEqual(['B']);
    expect(r.result[0].positionWin).toBeUndefined();
    expect(r.result[0].positionGames).toBeUndefined();
  });
});
