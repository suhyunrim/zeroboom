const mockModels = {
  group: { findByPk: jest.fn() },
  match: { count: jest.fn(), findAll: jest.fn() },
  summoner: { findOne: jest.fn() },
  match_player_stat: { findAll: jest.fn() },
  match_team_stat: { findAll: jest.fn() },
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
  teamNo: 1,
  item0: 3067,
  item1: 3075,
  item2: 0,
  item3: 0,
  item4: 0,
  item5: 0,
  item6: 3364,
  spell1Id: 4,
  spell2Id: 11,
  runeKeystoneId: 8437,
  runePrimaryStyleId: 8400,
  runeSubStyleId: 8300,
  champLevel: 17,
  doubleKills: 1,
  tripleKills: 0,
  quadraKills: 0,
  pentaKills: 0,
  largestMultiKill: 2,
  largestKillingSpree: 4,
  firstBloodKill: true,
  wardsPlaced: 8,
  wardsKilled: 5,
  controlWardsBought: 2,
  ...overrides,
});

const teamRow = (matchId, teamNo, overrides = {}) => ({
  matchId,
  teamNo,
  win: teamNo === 1,
  baronKills: 1,
  dragonKills: 2,
  riftHeraldKills: 0,
  hordeKills: 1,
  towerKills: 5,
  inhibitorKills: 1,
  firstBlood: teamNo === 1,
  firstTower: false,
  firstDragon: teamNo === 1,
  firstBaron: false,
  firstInhibitor: false,
  // 모델 인스턴스의 bansJson getter가 파싱된 배열을 반환하는 형태
  bansJson: [{ championId: 266, pickTurn: 1 }],
  gameVersion: '15.13.695.9598',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockModels.group.findByPk.mockResolvedValue({ id: 4 });
  mockModels.match.count.mockResolvedValue(2);
  mockModels.match_team_stat.findAll.mockResolvedValue([]);
});

describe('getMatchHistoryByGroupId 챔피언 스탯 부착 (additive)', () => {
  test('수집 매치는 players[].stat + 매치 gameDurationSec, 미수집 매치는 기존 그대로', async () => {
    const collected = snapshotMatch(100, ['a', 'b'], ['c', 'd']);
    const uncollected = snapshotMatch(101, ['a', 'b'], ['c', 'd']);
    mockModels.match.findAll.mockResolvedValue([collected, uncollected]);
    // 매치 100만 수집됨. 'b'는 스탯 없음(부분 매칭 케이스)
    mockModels.match_player_stat.findAll.mockResolvedValue([
      statRow(100, 'a'),
      statRow(100, 'c', { championId: 131, position: 'MIDDLE', win: false, teamNo: 2 }),
    ]);
    mockModels.match_team_stat.findAll.mockResolvedValue([teamRow(100, 1), teamRow(100, 2)]);

    const { status, result } = await getMatchHistoryByGroupId(4);
    expect(status).toBe(200);
    // 기존 응답 구조 유지 (additive 검증)
    expect(result).toMatchObject({ total: 2, page: 1, limit: 20, totalPages: 1 });
    expect(result.matches).toHaveLength(2);

    const [m100, m101] = result.matches;
    // 수집 매치: 매치 레벨 gameDurationSec + stat 부착
    expect(m100.gameDurationSec).toBe(2100);
    const playerA = m100.team1.players.find((x) => x.puuid === 'a');
    expect(playerA.stat).toMatchObject({
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
      // 상세 지표
      champLevel: 17,
      items: [3067, 3075, 0, 0, 0, 0],
      trinket: 3364,
      spell1Id: 4,
      spell2Id: 11,
      runeKeystoneId: 8437,
      runePrimaryStyleId: 8400,
      runeSubStyleId: 8300,
      doubleKills: 1,
      largestMultiKill: 2,
      largestKillingSpree: 4,
      firstBloodKill: true,
      wardsPlaced: 8,
      wardsKilled: 5,
      controlWardsBought: 2,
    });
    // 기존 필드는 그대로
    expect(playerA).toMatchObject({ puuid: 'a', name: 'n-a', rating: 500 });
    const playerC = m100.team2.players.find((x) => x.puuid === 'c');
    expect(playerC.stat.championKoName).toBe('챔프131');
    // 스탯 행 없는 플레이어는 stat 없음
    const playerB = m100.team1.players.find((x) => x.puuid === 'b');
    expect(playerB.stat).toBeUndefined();

    // 팀 오브젝트: team1 플레이어('a')의 teamNo=1 → teamStats.team1 = 인게임 1팀
    expect(m100.teamStats.team1).toMatchObject({
      baronKills: 1,
      dragonKills: 2,
      hordeKills: 1,
      firstBlood: true,
      firstDragon: true,
      bans: [{ championId: 266, pickTurn: 1 }],
    });
    expect(m100.teamStats.team2.firstBlood).toBe(false);
    expect(m100.gameVersion).toBe('15.13.695.9598');

    // 미수집 매치: stat/gameDurationSec/teamStats 없음
    expect(m101.gameDurationSec).toBeUndefined();
    expect(m101.teamStats).toBeUndefined();
    expect(m101.team1.players.every((x) => x.stat === undefined)).toBe(true);
  });

  test('내전 team1이 인게임 2팀이면 teamStats 방향이 뒤집혀 부착', async () => {
    mockModels.match.findAll.mockResolvedValue([snapshotMatch(100, ['a', 'b'], ['c', 'd'])]);
    // 내전 team1 소속 'a'가 인게임 2팀(teamNo=2)
    mockModels.match_player_stat.findAll.mockResolvedValue([
      statRow(100, 'a', { teamNo: 2 }),
      statRow(100, 'c', { teamNo: 1 }),
    ]);
    mockModels.match_team_stat.findAll.mockResolvedValue([
      teamRow(100, 1, { baronKills: 0 }),
      teamRow(100, 2, { baronKills: 9 }),
    ]);

    const { result } = await getMatchHistoryByGroupId(4);
    const m = result.matches[0];
    expect(m.teamStats.team1.baronKills).toBe(9); // 인게임 2팀 스탯이 내전 team1로
    expect(m.teamStats.team2.baronKills).toBe(0);
  });

  test('구버전 수집분(상세 지표 null)은 stat에 null로 내려감', async () => {
    mockModels.match.findAll.mockResolvedValue([snapshotMatch(100, ['a', 'b'], ['c', 'd'])]);
    mockModels.match_player_stat.findAll.mockResolvedValue([
      statRow(100, 'a', {
        teamNo: null,
        item0: null, item1: null, item2: null, item3: null, item4: null, item5: null, item6: null,
        spell1Id: null, spell2Id: null,
        runeKeystoneId: null, runePrimaryStyleId: null, runeSubStyleId: null,
        champLevel: null, doubleKills: null, tripleKills: null, quadraKills: null, pentaKills: null,
        largestMultiKill: null, largestKillingSpree: null, firstBloodKill: null,
        wardsPlaced: null, wardsKilled: null, controlWardsBought: null,
      }),
    ]);
    mockModels.match_team_stat.findAll.mockResolvedValue([]);

    const { result } = await getMatchHistoryByGroupId(4);
    const playerA = result.matches[0].team1.players.find((x) => x.puuid === 'a');
    // 기존 필드는 정상, 상세 지표는 null (프론트 폴백 처리)
    expect(playerA.stat.kills).toBe(13);
    expect(playerA.stat.champLevel).toBeNull();
    expect(playerA.stat.items).toEqual([null, null, null, null, null, null]);
    expect(playerA.stat.firstBloodKill).toBeNull();
    // teamNo 없으면 teamStats 방향 판별 불가 → 생략
    expect(result.matches[0].teamStats).toBeUndefined();
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
