const mockModels = {
  group: { findByPk: jest.fn() },
  match: { count: jest.fn(), findAll: jest.fn() },
  summoner: { findOne: jest.fn() },
  match_player_stat: { findAll: jest.fn() },
};
jest.mock('../../src/db/models', () => mockModels);
jest.mock('../../src/loaders/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../src/utils/champion-map', () => ({
  resolveChampionNames: jest.fn(async (ids) =>
    Object.fromEntries(ids.map((id) => [id, { name: `Champ${id}`, koName: `챔프${id}` }])),
  ),
}));
// match.js 의존성 체인의 riot-api(axios ESM)가 jest에서 파싱 안 되므로 차단
jest.mock('../../src/services/riot-api', () => ({}));

const { getMatchHistoryByGroupId } = require('../../src/controller/match');

// 레이팅 스냅샷 포맷 [puuid, name, rating, position]
const p = (puuid, rating = 500, position = null) => [puuid, `n-${puuid}`, rating, position];

const snapshotMatch = (gameId, team1Puuids, team2Puuids, winTeam = 1) => ({
  gameId,
  createdAt: new Date('2026-07-11T16:42:00Z'),
  winTeam,
  team1: team1Puuids.map((x) => p(x)),
  team2: team2Puuids.map((x) => p(x)),
});

const statRow = (matchId, puuid, overrides = {}) => ({
  matchId,
  puuid,
  championId: 64,
  kills: 13,
  deaths: 6,
  assists: 17,
  cs: 229,
  goldEarned: 15000,
  damageToChampions: 30000,
  damageTaken: 25000,
  visionScore: 20,
  position: 'JUNGLE',
  gameDurationSec: 2100,
  win: true,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockModels.group.findByPk.mockResolvedValue({ id: 4 });
  mockModels.match.count.mockResolvedValue(2);
});

describe('getMatchHistoryByGroupId 챔피언 스탯 부착 (additive)', () => {
  test('수집 매치는 players[].stat + 매치 gameDurationSec, 미수집 매치는 기존 그대로', async () => {
    const collected = snapshotMatch(100, ['a', 'b'], ['c', 'd']);
    const uncollected = snapshotMatch(101, ['a', 'b'], ['c', 'd']);
    mockModels.match.findAll.mockResolvedValue([collected, uncollected]);
    // 매치 100만 수집됨. 'b'는 스탯 없음(부분 매칭 케이스)
    mockModels.match_player_stat.findAll.mockResolvedValue([
      statRow(100, 'a'),
      statRow(100, 'c', { championId: 131, position: 'MIDDLE', win: false }),
    ]);

    const { status, result } = await getMatchHistoryByGroupId(4);
    expect(status).toBe(200);
    // 기존 응답 구조 유지 (additive 검증)
    expect(result).toMatchObject({ total: 2, page: 1, limit: 20, totalPages: 1 });
    expect(result.matches).toHaveLength(2);

    const [m100, m101] = result.matches;
    // 수집 매치: 매치 레벨 gameDurationSec + stat 부착
    expect(m100.gameDurationSec).toBe(2100);
    const playerA = m100.team1.players.find((x) => x.puuid === 'a');
    expect(playerA.stat).toEqual({
      championId: 64,
      championName: 'Champ64',
      championKoName: '챔프64',
      kills: 13,
      deaths: 6,
      assists: 17,
      cs: 229,
      goldEarned: 15000,
      damageToChampions: 30000,
      visionScore: 20,
      position: 'JUNGLE',
      gameDurationSec: 2100,
    });
    // 기존 필드는 그대로
    expect(playerA).toMatchObject({ puuid: 'a', name: 'n-a', rating: 500 });
    const playerC = m100.team2.players.find((x) => x.puuid === 'c');
    expect(playerC.stat.championKoName).toBe('챔프131');
    // 스탯 행 없는 플레이어는 stat 없음
    const playerB = m100.team1.players.find((x) => x.puuid === 'b');
    expect(playerB.stat).toBeUndefined();

    // 미수집 매치: stat/gameDurationSec 없음
    expect(m101.gameDurationSec).toBeUndefined();
    expect(m101.team1.players.every((x) => x.stat === undefined)).toBe(true);
  });

  test('스탯이 하나도 없으면 IN 쿼리 후 응답 무변경', async () => {
    mockModels.match.findAll.mockResolvedValue([snapshotMatch(100, ['a', 'b'], ['c', 'd'])]);
    mockModels.match_player_stat.findAll.mockResolvedValue([]);

    const { result } = await getMatchHistoryByGroupId(4);
    expect(result.matches[0].gameDurationSec).toBeUndefined();
    expect(result.matches[0].team1.players[0].stat).toBeUndefined();
  });

  test('매치가 0건이면 스탯 쿼리 안 함', async () => {
    mockModels.match.count.mockResolvedValue(0);
    mockModels.match.findAll.mockResolvedValue([]);

    const { result } = await getMatchHistoryByGroupId(4);
    expect(result.matches).toHaveLength(0);
    expect(mockModels.match_player_stat.findAll).not.toHaveBeenCalled();
  });
});
