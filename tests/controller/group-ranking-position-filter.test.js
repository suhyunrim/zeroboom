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

describe('getRanking - 포지션 필터 (방설정 rankingPositionSource=internal, 내전 최다 포지션)', () => {
  beforeEach(() => {
    mockModels.group.findOne.mockResolvedValue({ id: 1, settings: { rankingPositionSource: 'internal' } });
  });

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
    expect(r.positionSource).toBe('internal');

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

  test('내전 최다 포지션 필터에만 노출 (그 외 포지션은 5판 이상이어도 숨김)', async () => {
    mockModels.match.findAll.mockResolvedValue([
      // A: TOP 5판 + JUNGLE 7판 → 내전 메인은 JUNGLE
      ...Array.from({ length: 5 }, () => match([player('A', 'TOP')], [player('D', 'JUNGLE')], 1)),
      ...Array.from({ length: 7 }, () => match([player('A', 'JUNGLE')], [player('D', 'TOP')], 1)),
    ]);

    const top = await groupController.getRanking('그룹', 'TOP');
    expect(top.result).toEqual([]);

    const jungle = await groupController.getRanking('그룹', 'JUNGLE');
    expect(jungle.result.map((e) => e.puuid)).toEqual(['A']);
    expect(jungle.result[0]).toMatchObject({ positionWin: 7, positionGames: 7 });
  });

  test('공동 최다 포지션이면 양쪽 필터에 모두 노출', async () => {
    mockModels.match.findAll.mockResolvedValue([
      ...Array.from({ length: 5 }, () => match([player('A', 'TOP')], [player('D', 'JUNGLE')], 1)),
      ...Array.from({ length: 5 }, () => match([player('A', 'JUNGLE')], [player('D', 'TOP')], 1)),
    ]);

    const top = await groupController.getRanking('그룹', 'TOP');
    expect(top.result.map((e) => e.puuid)).toEqual(['A']);

    const jungle = await groupController.getRanking('그룹', 'JUNGLE');
    expect(jungle.result.map((e) => e.puuid)).toEqual(['A']);
  });

  test('최다 포지션이어도 5판 미만이면 숨김', async () => {
    mockModels.match.findAll.mockResolvedValue([
      // A: JUNGLE 4판이 최다지만 5판 미만
      ...Array.from({ length: 4 }, () => match([player('A', 'JUNGLE')], [player('D', 'TOP')], 1)),
      ...Array.from({ length: 2 }, () => match([player('A', 'TOP')], [player('D', 'JUNGLE')], 1)),
    ]);

    const r = await groupController.getRanking('그룹', 'JUNGLE');
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
    expect(r.positionSource).toBe('internal'); // 필터 전 안내용으로 항상 포함
  });
});

describe('getRanking - 포지션 필터 (기본값=솔로랭크 메인 포지션)', () => {
  test('방설정이 없으면 솔로랭크 기준: mainPosition이 해당 포지션인 유저만 노출, 내전 매치 조회 없음, mainPositionRate 포함', async () => {
    mockModels.summoner.findAll.mockResolvedValue([
      { puuid: 'A', name: '에이', mainPosition: 'TOP', mainPositionRate: 82.5 },
      { puuid: 'B', name: '비', mainPosition: 'JUNGLE', mainPositionRate: 70 },
      { puuid: 'C', name: '씨', mainPosition: 'TOP', mainPositionRate: 60 },
    ]);

    const r = await groupController.getRanking('그룹', 'TOP');
    expect(r.status).toBe(200);
    expect(r.positionSource).toBe('solo');
    expect(mockModels.match.findAll).not.toHaveBeenCalled();

    // C(1000) > A(900) 레이팅 내림차순, B는 JUNGLE이라 제외
    expect(r.result.map((e) => e.puuid)).toEqual(['C', 'A']);
    expect(r.result[0]).toEqual({
      puuid: 'C',
      ranking: 1,
      name: '씨',
      rating: 1000,
      win: 10,
      lose: 10,
      winRate: 50,
      mainPositionRate: 60,
    });
    expect(r.result[0].positionWin).toBeUndefined();
    expect(r.result[1]).toMatchObject({ puuid: 'A', ranking: 2, mainPositionRate: 82.5 });
  });

  test('mainPositionRate 0(솔로랭크 포지션 데이터 없음)이면 제외', async () => {
    mockModels.summoner.findAll.mockResolvedValue([
      { puuid: 'A', name: '에이', mainPosition: 'TOP', mainPositionRate: 0 },
      { puuid: 'B', name: '비', mainPosition: 'TOP', mainPositionRate: 90 },
      { puuid: 'C', name: '씨', mainPosition: 'JUNGLE', mainPositionRate: 50 },
    ]);

    const r = await groupController.getRanking('그룹', 'TOP');
    expect(r.result.map((e) => e.puuid)).toEqual(['B']);
  });

  test('총 내전 5판 미만이면 mainPosition이 일치해도 제외', async () => {
    mockModels.user.findAll.mockResolvedValue([
      makeUser('A', 900, 2, 2), // 총 4판 → 컷 미달
      makeUser('B', 700, 10, 10),
    ]);
    mockModels.summoner.findAll.mockResolvedValue([
      { puuid: 'A', name: '에이', mainPosition: 'TOP', mainPositionRate: 80 },
      { puuid: 'B', name: '비', mainPosition: 'TOP', mainPositionRate: 75 },
    ]);

    const r = await groupController.getRanking('그룹', 'TOP');
    expect(r.result.map((e) => e.puuid)).toEqual(['B']);
  });

  test('position 미지정이면 기존 전체 랭킹과 동일, positionSource는 항상 포함', async () => {
    const r = await groupController.getRanking('그룹');
    expect(mockModels.match.findAll).not.toHaveBeenCalled();
    expect(r.result.map((e) => e.puuid)).toEqual(['C', 'A', 'B']);
    expect(r.positionSource).toBe('solo');
    expect(r.result[0].mainPositionRate).toBeUndefined();
  });
});
