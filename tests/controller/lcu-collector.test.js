const mockModels = {
  match: { findAll: jest.fn() },
  lcu_game_raw: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() },
  match_player_stat: { bulkCreate: jest.fn() },
};
jest.mock('../../src/db/models', () => mockModels);
jest.mock('../../src/loaders/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const {
  extractPlayers,
  resolveTeamPositions,
  pickBestCandidate,
  mapRaw,
} = require('../../src/controller/lcu-collector');

// 실제 내전 게임 원본 (현수필 제공, 2026-07-11)
const realGame = require('../fixtures/lcu-custom-game-8294822545.json');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('extractPlayers', () => {
  test('실데이터에서 10명 추출, puuid/챔피언/스탯 포함', () => {
    const players = extractPlayers(realGame);
    expect(players).toHaveLength(10);
    const diana = players.find((p) => p.championId === 131);
    expect(diana.gameName).toBe('과테말라호빵장수');
    expect(diana.puuid).toBe('54b7656f-303d-564b-81a4-bba767f941fa');
    expect(diana.cs).toBe(28 + 174); // 미니언 + 정글몹
    expect(diana.neutralCs).toBe(174);
    expect(diana.win).toBe(false);
  });
});

describe('resolveTeamPositions', () => {
  test('실데이터 팀100: 퀘스트 아이템 + 원딜 소거법', () => {
    const players = extractPlayers(realGame);
    const team100 = players.filter((p) => p.teamId === 100);
    const positions = resolveTeamPositions(team100);

    const posOf = (championId) =>
      positions.get(team100.find((p) => p.championId === championId).participantId);
    expect(posOf(516)).toBe('TOP'); // 오른 (1221)
    expect(posOf(131)).toBe('JUNGLE'); // 다이애나 (1209)
    expect(posOf(50)).toBe('MIDDLE'); // 스웨인 (1206)
    expect(posOf(53)).toBe('UTILITY'); // 블리츠 (2055)
    expect(posOf(145)).toBe('BOTTOM'); // 카이사 (신발 → 소거법)
  });

  test('퀘스트 아이템이 없으면 강타/CS 휴리스틱 폴백', () => {
    const team = [
      { participantId: 1, roleBoundItem: 0, spell1Id: 4, spell2Id: 12, cs: 200, neutralCs: 0 },
      { participantId: 2, roleBoundItem: 0, spell1Id: 11, spell2Id: 4, cs: 180, neutralCs: 160 }, // 강타
      { participantId: 3, roleBoundItem: 0, spell1Id: 4, spell2Id: 14, cs: 210, neutralCs: 0 },
      { participantId: 4, roleBoundItem: 0, spell1Id: 4, spell2Id: 21, cs: 250, neutralCs: 0 },
      { participantId: 5, roleBoundItem: 0, spell1Id: 14, spell2Id: 4, cs: 30, neutralCs: 0 }, // 저CS
    ];
    const positions = resolveTeamPositions(team);
    expect(positions.get(2)).toBe('JUNGLE');
    expect(positions.get(5)).toBe('UTILITY');
    // 탑/미드/원딜은 구분 불가 → null 유지
    expect(positions.get(1)).toBeNull();
  });

  test('같은 포지션 중복 주장 시 보류 후 휴리스틱', () => {
    const team = [
      { participantId: 1, roleBoundItem: 1209, spell1Id: 4, spell2Id: 12, cs: 200, neutralCs: 5 },
      { participantId: 2, roleBoundItem: 1209, spell1Id: 11, spell2Id: 4, cs: 180, neutralCs: 160 },
      { participantId: 3, roleBoundItem: 1206, spell1Id: 4, spell2Id: 14, cs: 210, neutralCs: 0 },
      { participantId: 4, roleBoundItem: 3006, spell1Id: 4, spell2Id: 21, cs: 250, neutralCs: 0 },
      { participantId: 5, roleBoundItem: 2055, spell1Id: 14, spell2Id: 4, cs: 30, neutralCs: 0 },
    ];
    const positions = resolveTeamPositions(team);
    expect(positions.get(3)).toBe('MIDDLE');
    expect(positions.get(5)).toBe('UTILITY');
    expect(positions.get(2)).toBe('JUNGLE'); // 강타 보유자가 정글
  });
});

describe('pickBestCandidate', () => {
  const puuids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const asTeams = (list) => ({
    team1: list.slice(0, 5).map((p) => [p, '이름', 500, null]),
    team2: list.slice(5).map((p) => [p, '이름', 500, null]),
  });
  const T0 = new Date('2026-07-11T16:42:00Z');

  test('8명 이상 일치하는 match 선택, 7명 이하는 거부', () => {
    const full = { gameId: 1, gameCreation: T0, ...asTeams(puuids) };
    const partial = {
      gameId: 2,
      gameCreation: T0,
      ...asTeams(['a', 'b', 'c', 'x', 'y', 'z', 'w', 'v', 'u', 't']),
    };
    expect(pickBestCandidate(puuids, T0, [partial, full]).gameId).toBe(1);
    expect(pickBestCandidate(puuids, T0, [partial])).toBeNull();
  });

  test('같은 10인 연속 2판이면 시간이 가까운 match 선택', () => {
    const earlier = { gameId: 1, gameCreation: new Date('2026-07-11T16:00:00Z'), ...asTeams(puuids) };
    const closer = { gameId: 2, gameCreation: new Date('2026-07-11T16:40:00Z'), ...asTeams(puuids) };
    expect(pickBestCandidate(puuids, T0, [earlier, closer]).gameId).toBe(2);
  });
});

describe('mapRaw (실데이터 통합)', () => {
  test('내전 match와 매핑되어 10행 생성, 포지션/맞라인 diff 포함', async () => {
    const players = extractPlayers(realGame);
    const team100Puuids = players.filter((p) => p.teamId === 100).map((p) => p.puuid);
    const team200Puuids = players.filter((p) => p.teamId === 200).map((p) => p.puuid);

    const match = {
      gameId: 777,
      seasonId: 3,
      gameCreation: new Date(realGame.gameCreation),
      team1: team100Puuids.map((p) => [p, '이름', 500, null]),
      team2: team200Puuids.map((p) => [p, '이름', 500, null]),
    };
    mockModels.match.findAll.mockResolvedValue([match]);
    mockModels.lcu_game_raw.findAll.mockResolvedValue([]);
    mockModels.match_player_stat.bulkCreate.mockResolvedValue([]);

    const raw = {
      id: 1,
      riotGameKey: 'KR_8294822545',
      groupId: 2,
      gameCreation: new Date(realGame.gameCreation),
      gameDuration: realGame.gameDuration,
      rawJson: realGame,
      save: jest.fn(),
    };

    const result = await mapRaw(raw);
    expect(result.mapped).toBe(true);
    expect(result.matchId).toBe(777);
    expect(raw.mappedMatchId).toBe(777);
    expect(raw.save).toHaveBeenCalled();

    const rows = mockModels.match_player_stat.bulkCreate.mock.calls[0][0];
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.matchId === 777 && r.groupId === 2 && r.seasonId === 3)).toBe(true);

    // 정글 맞라인: 다이애나(cs 202) vs 리신(cs 229) → csDiff -27
    const diana = rows.find((r) => r.puuid === '54b7656f-303d-564b-81a4-bba767f941fa');
    expect(diana.position).toBe('JUNGLE');
    expect(diana.csDiff).toBe(202 - 229);
    expect(diana.win).toBe(false);

    // 팀2 전원 승리
    const team200Rows = rows.filter((r) => team200Puuids.includes(r.puuid));
    expect(team200Rows.every((r) => r.win)).toBe(true);
  });

  test('일치하는 내전 기록이 없으면 미매핑 유지', async () => {
    mockModels.match.findAll.mockResolvedValue([]);
    mockModels.lcu_game_raw.findAll.mockResolvedValue([]);

    const raw = {
      id: 1,
      riotGameKey: 'KR_8294822545',
      groupId: 2,
      gameCreation: new Date(realGame.gameCreation),
      gameDuration: realGame.gameDuration,
      rawJson: realGame,
      save: jest.fn(),
    };

    const result = await mapRaw(raw);
    expect(result.mapped).toBe(false);
    expect(raw.save).not.toHaveBeenCalled();
    expect(mockModels.match_player_stat.bulkCreate).not.toHaveBeenCalled();
  });
});
