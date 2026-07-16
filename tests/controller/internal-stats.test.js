const mockModels = {
  match_player_stat: { findAll: jest.fn() },
  lcu_game_raw: { findAll: jest.fn() },
};
jest.mock('../../src/db/models', () => mockModels);
jest.mock('../../src/utils/champion-map', () => ({
  resolveChampionNames: jest.fn(async (ids) =>
    Object.fromEntries(ids.map((id) => [id, { name: `Champ${id}`, koName: `챔프${id}` }])),
  ),
}));

const { getUserInternalStats, getChampionTierlist } = require('../../src/controller/internal-stats');

const row = (overrides) => ({
  riotGameKey: 'KR_1',
  puuid: 'me',
  position: 'MIDDLE',
  championId: 1,
  kills: 5,
  deaths: 5,
  assists: 5,
  cs: 200,
  goldEarned: 12000,
  damageToChampions: 20000,
  damageTaken: 20000,
  visionScore: 30,
  gameDurationSec: 1800, // 30분
  win: true,
  laneOpponentPuuid: 'them',
  csDiff: 10,
  goldDiff: 500,
  damageDiff: 1000,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getUserInternalStats', () => {
  test('챔피언별/포지션별 집계와 라인전 지표', async () => {
    mockModels.match_player_stat.findAll.mockResolvedValue([
      row({ riotGameKey: 'KR_1', championId: 1, win: true, kills: 10, deaths: 2, assists: 6 }),
      row({ riotGameKey: 'KR_2', championId: 1, win: false, kills: 2, deaths: 6, assists: 4, csDiff: -20, goldDiff: -800, damageDiff: -2000 }),
      row({ riotGameKey: 'KR_3', championId: 7, win: true, position: 'TOP', csDiff: null, goldDiff: null, damageDiff: null }),
    ]);

    const stats = await getUserInternalStats({ groupId: 2, puuid: 'me' });
    expect(stats.totalGames).toBe(3);
    expect(stats.wins).toBe(2);

    const champ1 = stats.champions.find((c) => c.championId === 1);
    expect(champ1.games).toBe(2);
    expect(champ1.winRate).toBe(50);
    expect(champ1.kda).toBe((10 + 2 + 6 + 4) / (2 + 6)); // 2.75
    expect(champ1.championKoName).toBe('챔프1');
    expect(champ1.csPerMin).toBe(round1(200 / 30));

    const mid = stats.positions.find((p) => p.position === 'MIDDLE');
    expect(mid.games).toBe(2);
    expect(mid.laneGames).toBe(2);
    expect(mid.csDiffAvg).toBe((10 + -20) / 2);
    expect(mid.goldDiffAvg).toBe(Math.round((500 - 800) / 2));

    // 맞라인 diff 없는 판은 라인전 지표에서 제외
    const top = stats.positions.find((p) => p.position === 'TOP');
    expect(top.games).toBe(1);
    expect(top.laneGames).toBe(0);
    expect(top.csDiffAvg).toBeNull();
  });

  test('기록 없으면 빈 결과', async () => {
    mockModels.match_player_stat.findAll.mockResolvedValue([]);
    const stats = await getUserInternalStats({ groupId: 2, puuid: 'me' });
    expect(stats).toEqual({ totalGames: 0, wins: 0, champions: [], positions: [] });
  });
});

describe('getChampionTierlist', () => {
  test('minGames 컷 + 픽률/밴률/보정점수', async () => {
    // 게임 3판: 챔프1은 3판(2승), 챔프2는 1판 → minGames=2 컷에 걸림
    mockModels.match_player_stat.findAll.mockResolvedValue([
      row({ riotGameKey: 'KR_1', puuid: 'a', championId: 1, win: true }),
      row({ riotGameKey: 'KR_2', puuid: 'a', championId: 1, win: true }),
      row({ riotGameKey: 'KR_3', puuid: 'b', championId: 1, win: false }),
      row({ riotGameKey: 'KR_3', puuid: 'c', championId: 2, win: true }),
    ]);
    mockModels.lcu_game_raw.findAll.mockResolvedValue([
      { bansJson: JSON.stringify([{ championId: 1, teamId: 100, pickTurn: 1 }]) },
      { bansJson: JSON.stringify([{ championId: 9, teamId: 200, pickTurn: 2 }]) },
    ]);

    const result = await getChampionTierlist({ groupId: 2, minGames: 2 });
    expect(result.totalGames).toBe(3);
    expect(result.champions).toHaveLength(1);

    const champ1 = result.champions[0];
    expect(champ1.championId).toBe(1);
    expect(champ1.games).toBe(3);
    expect(champ1.winRate).toBe(round1((2 / 3) * 100));
    expect(champ1.pickRate).toBe(100);
    expect(champ1.banCount).toBe(1);
    expect(champ1.banRate).toBe(round1((1 / 3) * 100));
    // 보정점수: (2 + 2.5) / (3 + 5) * 100 = 56.25 → 56.3
    expect(champ1.score).toBe(56.3);
  });

  test('포지션 필터 적용', async () => {
    mockModels.match_player_stat.findAll.mockResolvedValue([
      row({ riotGameKey: 'KR_1', puuid: 'a', championId: 1, position: 'TOP' }),
      row({ riotGameKey: 'KR_1', puuid: 'b', championId: 2, position: 'JUNGLE' }),
    ]);
    mockModels.lcu_game_raw.findAll.mockResolvedValue([]);

    const result = await getChampionTierlist({ groupId: 2, position: 'TOP', minGames: 1 });
    expect(result.champions).toHaveLength(1);
    expect(result.champions[0].championId).toBe(1);
  });
});

function round1(v) {
  return Math.round(v * 10) / 10;
}
