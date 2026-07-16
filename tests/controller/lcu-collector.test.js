const mockModels = {
  user: { findAll: jest.fn() },
  summoner: { findAll: jest.fn() },
  match: { findAll: jest.fn() },
  lcu_game_raw: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() },
  match_player_stat: { bulkCreate: jest.fn(), findAll: jest.fn(), update: jest.fn() },
};
jest.mock('../../src/db/models', () => mockModels);
jest.mock('../../src/loaders/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const {
  extractPlayers,
  resolveTeamPositions,
  pickBestCandidate,
  processRaw,
  resolveDbPuuids,
  ingestGame,
  resolveGroupFromPuuids,
} = require('../../src/controller/lcu-collector');

// 실제 내전 게임 원본 (현수필 제공, 2026-07-11)
const realGame = require('../fixtures/lcu-custom-game-8294822545.json');

// LCU puuid ↔ 우리 DB puuid 브릿지 모킹용: Riot ID를 LCU puuid에 그대로 매핑(항등)
const identitySummoners = (game) =>
  (game.participantIdentities || []).map((it) => ({
    name: `${it.player.gameName}#${it.player.tagLine}`,
    puuid: it.player.puuid,
  }));

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

describe('resolveDbPuuids (Riot ID 브릿지)', () => {
  test('등록 소환사는 우리 DB puuid로 변환, 미등록은 LCU puuid 폴백', async () => {
    const players = extractPlayers(realGame);
    const hyunsupil = players.find((p) => p.gameName === '현수필');
    const guest = players.find((p) => p.gameName === 'Kanose');
    // 현수필만 DB에 등록됐다고 가정
    mockModels.summoner.findAll.mockResolvedValue([{ name: '현수필#KR6', puuid: 'DB_HYUNSUPIL' }]);

    const map = await resolveDbPuuids(players);
    expect(map.get(hyunsupil.participantId)).toBe('DB_HYUNSUPIL');
    expect(map.get(guest.participantId)).toBe(guest.puuid); // 미등록 → LCU puuid 폴백
  });
});

describe('processRaw (실데이터 통합)', () => {
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
    // summoners가 Riot ID→LCU puuid 항등 매핑 → dbPuuid == LCU puuid (기존 검증 유지)
    mockModels.summoner.findAll.mockResolvedValue(identitySummoners(realGame));
    mockModels.user.findAll.mockResolvedValue([]); // 부캐 없음
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

    const result = await processRaw(raw);
    expect(result.statsCreated).toBe(true);
    expect(result.mapped).toBe(true);
    expect(result.matchId).toBe(777);
    // team200(내전 team2) 전원 승리 → winTeam 2
    expect(result.winTeam).toBe(2);
    expect(raw.mappedMatchId).toBe(777);
    expect(raw.statsProcessedAt).toBeInstanceOf(Date);
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

  test('봇 match가 없어도 통계는 생성(수동 커스텀), matchId/seasonId는 null', async () => {
    mockModels.summoner.findAll.mockResolvedValue(identitySummoners(realGame));
    mockModels.user.findAll.mockResolvedValue([]);
    mockModels.match.findAll.mockResolvedValue([]);
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

    const result = await processRaw(raw);
    expect(result.statsCreated).toBe(true);
    expect(result.mapped).toBe(false);
    expect(result.matchId).toBeNull();
    expect(result.winTeam).toBeNull();
    expect(raw.mappedMatchId).toBeUndefined();
    expect(raw.statsProcessedAt).toBeInstanceOf(Date);
    expect(raw.save).toHaveBeenCalled();

    const rows = mockModels.match_player_stat.bulkCreate.mock.calls[0][0];
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.matchId === null && r.seasonId === null)).toBe(true);
    // 포지션/맞라인 diff는 봇 match 없이도 계산됨
    const diana = rows.find((r) => r.puuid === '54b7656f-303d-564b-81a4-bba767f941fa');
    expect(diana.position).toBe('JUNGLE');
    expect(diana.csDiff).toBe(202 - 229);
  });

  test('부캐로 뛴 판은 본캐 puuid로 승격 저장 + 본캐 로스터 match와 매핑', async () => {
    const players = extractPlayers(realGame);
    const KANOSE_LCU = players.find((p) => p.gameName === 'Kanose').puuid;

    // Kanose#8793은 KANOSE_DB로 등록돼 있고, 그룹 내 부캐(본캐=LADAY_DB)
    const summoners = identitySummoners(realGame).map((s) =>
      s.name === 'Kanose#8793' ? { ...s, puuid: 'KANOSE_DB' } : s,
    );
    mockModels.summoner.findAll.mockResolvedValue(summoners);
    mockModels.user.findAll.mockResolvedValue([{ puuid: 'KANOSE_DB', primaryPuuid: 'LADAY_DB' }]);

    // 봇 match 로스터는 본캐(LADAY_DB) 기준
    const teamPuuids = (teamId) =>
      players.filter((p) => p.teamId === teamId).map((p) => (p.puuid === KANOSE_LCU ? 'LADAY_DB' : p.puuid));
    const match = {
      gameId: 888,
      seasonId: null,
      gameCreation: new Date(realGame.gameCreation),
      team1: teamPuuids(100).map((p) => [p, '이름', 500, null]),
      team2: teamPuuids(200).map((p) => [p, '이름', 500, null]),
    };
    mockModels.match.findAll.mockResolvedValue([match]);
    mockModels.lcu_game_raw.findAll.mockResolvedValue([]);
    mockModels.match_player_stat.bulkCreate.mockResolvedValue([]);

    const raw = {
      id: 1,
      riotGameKey: 'KR_8294822545',
      groupId: 4,
      gameCreation: new Date(realGame.gameCreation),
      gameDuration: realGame.gameDuration,
      rawJson: realGame,
      save: jest.fn(),
    };

    const result = await processRaw(raw);
    expect(result.mapped).toBe(true);
    expect(result.matchId).toBe(888);

    const rows = mockModels.match_player_stat.bulkCreate.mock.calls[0][0];
    // Kanose(리신) 스탯이 본캐 puuid로 저장됨
    const leeSin = rows.find((r) => r.championId === 64);
    expect(leeSin.puuid).toBe('LADAY_DB');
    // 맞라인 상대 참조도 승격된 puuid 기준
    const diana = rows.find((r) => r.championId === 131);
    expect(diana.laneOpponentPuuid).toBe('LADAY_DB');
  });

  test('미확정 match의 createdAt 폴백 창은 게임 시각 +24h', async () => {
    mockModels.summoner.findAll.mockResolvedValue(identitySummoners(realGame));
    mockModels.user.findAll.mockResolvedValue([]);
    mockModels.match.findAll.mockResolvedValue([]);
    mockModels.lcu_game_raw.findAll.mockResolvedValue([]);
    mockModels.match_player_stat.bulkCreate.mockResolvedValue([]);

    const gameTime = new Date(realGame.gameCreation).getTime();
    const raw = {
      id: 1,
      riotGameKey: 'KR_8294822545',
      groupId: 4,
      gameCreation: new Date(realGame.gameCreation),
      gameDuration: realGame.gameDuration,
      rawJson: realGame,
      save: jest.fn(),
    };
    await processRaw(raw);

    const where = mockModels.match.findAll.mock.calls[0][0].where;
    const { Op } = require('sequelize');
    const fallback = where[Op.or][1].createdAt[Op.between];
    expect(fallback[1].getTime()).toBe(gameTime + 24 * 60 * 60 * 1000);
  });
});

describe('resolveGroupFromPuuids', () => {
  test('가장 많이 속한 그룹 선택 (최소 인원 충족)', async () => {
    mockModels.user.findAll.mockResolvedValue([
      { groupId: 2, puuid: 'a' },
      { groupId: 2, puuid: 'b' },
      { groupId: 2, puuid: 'c' },
      { groupId: 2, puuid: 'd' },
      { groupId: 4, puuid: 'e' },
    ]);
    const groupId = await resolveGroupFromPuuids(['a', 'b', 'c', 'd', 'e']);
    expect(groupId).toBe(2);
  });

  test('등록 인원이 최소치(4) 미만이면 null', async () => {
    mockModels.user.findAll.mockResolvedValue([
      { groupId: 2, puuid: 'a' },
      { groupId: 2, puuid: 'b' },
      { groupId: 4, puuid: 'e' },
    ]);
    const groupId = await resolveGroupFromPuuids(['a', 'b', 'e']);
    expect(groupId).toBeNull();
  });
});

describe('ingestGame (무설정 자동 인식)', () => {
  const uploader = '65c73467-c454-59fd-a502-9504f4ed8986'; // 현수필 (실데이터 참가자)

  test('업로더가 참가자가 아니면 거부', async () => {
    const result = await ingestGame({ uploaderPuuid: 'stranger', game: realGame });
    expect(result.status).toBe('rejected');
    expect(result.reason).toBe('uploader_not_participant');
    expect(mockModels.lcu_game_raw.create).not.toHaveBeenCalled();
  });

  test('그룹 판별 실패 시 skipped (저장 안 함)', async () => {
    mockModels.lcu_game_raw.findOne.mockResolvedValue(null);
    mockModels.summoner.findAll.mockResolvedValue([]); // 소환사 미등록 → LCU puuid 폴백
    mockModels.user.findAll.mockResolvedValue([]); // 아무도 그룹 등록 안 됨
    const result = await ingestGame({ uploaderPuuid: uploader, game: realGame });
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('no_group');
    expect(mockModels.lcu_game_raw.create).not.toHaveBeenCalled();
  });

  test('이미 있는 게임이면 duplicate', async () => {
    mockModels.lcu_game_raw.findOne.mockResolvedValue({ id: 1 });
    const result = await ingestGame({ uploaderPuuid: uploader, game: realGame });
    expect(result.status).toBe('duplicate');
    expect(mockModels.lcu_game_raw.create).not.toHaveBeenCalled();
  });

  test('정상 저장 + 그룹 자동 판별 + 통계 생성', async () => {
    mockModels.lcu_game_raw.findOne.mockResolvedValue(null);
    mockModels.summoner.findAll.mockResolvedValue(identitySummoners(realGame)); // Riot ID→LCU puuid 항등
    // 팀100 5명이 그룹2로 등록됨 → 그룹2 판별. 두 번째 호출은 부캐 승격 조회(없음)
    const team100 = extractPlayers(realGame)
      .filter((p) => p.teamId === 100)
      .map((p) => ({ groupId: 2, puuid: p.puuid }));
    mockModels.user.findAll.mockResolvedValueOnce(team100).mockResolvedValueOnce([]);
    mockModels.lcu_game_raw.create.mockResolvedValue({
      id: 9,
      riotGameKey: 'KR_8294822545',
      groupId: 2,
      gameCreation: new Date(realGame.gameCreation),
      gameDuration: realGame.gameDuration,
      rawJson: realGame,
      save: jest.fn(),
    });
    mockModels.match.findAll.mockResolvedValue([]); // 봇 match 없음 → 통계만 생성
    mockModels.lcu_game_raw.findAll.mockResolvedValue([]);
    mockModels.match_player_stat.bulkCreate.mockResolvedValue([]);

    const result = await ingestGame({ uploaderPuuid: uploader, game: realGame });
    expect(result.status).toBe('created');
    expect(result.groupId).toBe(2);
    expect(result.statsCreated).toBe(true);
    expect(result.mapped).toBe(false);
    expect(mockModels.lcu_game_raw.create).toHaveBeenCalled();
    const createArg = mockModels.lcu_game_raw.create.mock.calls[0][0];
    expect(createArg.groupId).toBe(2);
    expect(createArg.bansJson).toHaveLength(10);
    // 봇 match 없어도 10행 생성
    expect(mockModels.match_player_stat.bulkCreate).toHaveBeenCalled();
    expect(mockModels.match_player_stat.bulkCreate.mock.calls[0][0]).toHaveLength(10);
  });
});
