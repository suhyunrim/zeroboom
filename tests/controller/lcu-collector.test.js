const mockModels = {
  user: { findAll: jest.fn() },
  summoner: { findAll: jest.fn() },
  match: { findAll: jest.fn() },
  lcu_game_raw: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() },
  match_player_stat: { bulkCreate: jest.fn(), findAll: jest.fn(), update: jest.fn(), destroy: jest.fn() },
  match_team_stat: { bulkCreate: jest.fn(), update: jest.fn(), destroy: jest.fn() },
  summoner_name_history: { findAll: jest.fn() },
  tournament: { findAll: jest.fn() },
  tournament_team: { findAll: jest.fn() },
  tournament_scrim: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), destroy: jest.fn() },
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
  mockModels.summoner_name_history.findAll.mockResolvedValue([]);
  mockModels.tournament.findAll.mockResolvedValue([]); // 진행 중 대회 없음 (스크림 미판정)
  mockModels.tournament_team.findAll.mockResolvedValue([]);
  mockModels.tournament_scrim.findAll.mockResolvedValue([]); // 수동 기록 없음 (중복 가드 미발동)
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
  // 인게임 편성: 앞 5명이 블루(100), 뒤 5명이 레드(200)
  const sides = new Map(puuids.map((p, i) => [p, i < 5 ? 100 : 200]));
  const T0 = new Date('2026-07-11T16:42:00Z');

  test('8명 이상 일치하는 match 선택, 7명 이하는 거부', () => {
    const full = { gameId: 1, gameCreation: T0, ...asTeams(puuids) };
    const partial = {
      gameId: 2,
      gameCreation: T0,
      ...asTeams(['a', 'b', 'c', 'x', 'y', 'z', 'w', 'v', 'u', 't']),
    };
    expect(pickBestCandidate(sides, T0, [partial, full]).gameId).toBe(1);
    expect(pickBestCandidate(sides, T0, [partial])).toBeNull();
  });

  test('같은 10인이라도 세션이 다르면 시간이 가까운 match 선택', () => {
    const earlier = { gameId: 1, gameCreation: new Date('2026-07-11T16:00:00Z'), ...asTeams(puuids) };
    const closer = { gameId: 2, gameCreation: new Date('2026-07-11T16:40:00Z'), ...asTeams(puuids) };
    expect(pickBestCandidate(sides, T0, [earlier, closer]).gameId).toBe(2);
  });

  test('연속 판을 미리 만들어둔 플랜은 생성 순서대로 (첫 게임 → 먼저 만든 플랜)', () => {
    // 3판 2선승: 같은 편성 플랜 2개를 8초 간격으로 생성 → 시간 근접도로는 구분되지 않는다
    const first = { gameId: 2108, gameCreation: new Date('2026-07-11T16:30:10Z'), ...asTeams(puuids) };
    const second = { gameId: 2109, gameCreation: new Date('2026-07-11T16:30:18Z'), ...asTeams(puuids) };
    expect(pickBestCandidate(sides, T0, [first, second]).gameId).toBe(2108);
    expect(pickBestCandidate(sides, T0, [second, first]).gameId).toBe(2108);
  });

  test('먼저 만들었어도 뚜렷이 앞선 플랜(버려지고 다시 만든 경우)은 선택하지 않는다', () => {
    // 20:05 플랜을 버리고 20:06에 2연전 플랜을 다시 만든 실측 케이스 (게임은 20:18)
    const T = new Date('2026-07-16T20:18:00Z');
    const discarded = { gameId: 2103, gameCreation: new Date('2026-07-16T20:05:02Z'), ...asTeams(puuids) };
    const game1 = { gameId: 2104, gameCreation: new Date('2026-07-16T20:06:09Z'), ...asTeams(puuids) };
    const game2 = { gameId: 2105, gameCreation: new Date('2026-07-16T20:06:13Z'), ...asTeams(puuids) };
    expect(pickBestCandidate(sides, T, [discarded, game1, game2]).gameId).toBe(2104);
  });

  test('1승 1패 후 3판째 플랜을 새로 만들어도, 앞선 게임은 이미 있던 플랜에 붙는다', () => {
    // 3판 2선승: 플랜 2개를 먼저 만들고 → 1승 1패 → 3판째 플랜 추가 생성.
    // 수집이 늦어져 세 판이 한꺼번에 올라와도 각 게임은 "그 시점에 존재하던 플랜"에 붙어야 한다.
    const planA = { gameId: 100, createdAt: new Date('2026-07-11T21:00:00Z'), ...asTeams(puuids) };
    const planB = { gameId: 101, createdAt: new Date('2026-07-11T21:00:05Z'), ...asTeams(puuids) };
    const planC = { gameId: 102, createdAt: new Date('2026-07-11T22:30:00Z'), ...asTeams(puuids) };
    const all = [planA, planB, planC];

    const game1 = new Date('2026-07-11T21:10:00Z');
    const game2 = new Date('2026-07-11T21:50:00Z');
    const game3 = new Date('2026-07-11T22:35:00Z');

    // 1판: 세 플랜 모두 후보지만 C는 아직 존재하지 않았음 → 먼저 만든 A
    expect(pickBestCandidate(sides, game1, all).gameId).toBe(100);
    // 2판: A는 이미 매핑됨. C는 이 시점에 없었으므로 시간이 더 가까워도 B가 맞다
    expect(pickBestCandidate(sides, game2, [planB, planC]).gameId).toBe(101);
    // 3판: 남은 C
    expect(pickBestCandidate(sides, game3, [planC]).gameId).toBe(102);
  });

  test('게임 후에 만든 매치도 다른 후보가 훨씬 멀면 사후 기록으로 인정한다', () => {
    // 실측(7/16): 21:34 게임을 하고 22:05에 매치를 만들어 기록. 89분 전 버려진 플랜보다 이쪽이 맞다
    const T = new Date('2026-07-16T21:34:00Z');
    const discarded = { gameId: 2103, createdAt: new Date('2026-07-16T20:05:02Z'), ...asTeams(puuids) };
    const postGame = { gameId: 2106, createdAt: new Date('2026-07-16T22:05:51Z'), ...asTeams(puuids) };
    expect(pickBestCandidate(sides, T, [discarded, postGame]).gameId).toBe(2106);
  });

  test('같은 10인이라도 팀 편성이 다른 플랜(버려진 플랜)은 선택하지 않는다', () => {
    // 2명을 맞바꾼 다른 플랜이 먼저 만들어졌어도, 실제 편성과 맞는 플랜이 우선
    const swapped = ['a', 'b', 'c', 'i', 'j', 'f', 'g', 'h', 'd', 'e'];
    const discarded = { gameId: 2107, gameCreation: new Date('2026-07-11T16:29:00Z'), ...asTeams(swapped) };
    const played = { gameId: 2108, gameCreation: new Date('2026-07-11T16:30:10Z'), ...asTeams(puuids) };
    expect(pickBestCandidate(sides, T0, [discarded, played]).gameId).toBe(2108);
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

  test('닉변 후 업로드된 옛닉 게임은 닉네임 이력에서 게임 당시 주인으로 해결', async () => {
    const players = extractPlayers(realGame);
    const target = players.find((p) => p.gameName === '현수필'); // 옛닉 "현수필#KR6"으로 뛴 판
    const gameTime = new Date('2026-07-11T16:42:00');

    // 현재 summoners에는 옛닉이 없음 (이미 새 닉으로 갱신됨)
    mockModels.summoner.findAll.mockResolvedValue([]);
    // 이력: 게임 이후에 닉변 감지됨 → 게임 당시엔 그 이름의 주인
    mockModels.summoner_name_history.findAll.mockResolvedValue([
      { name: '현수필#KR6', puuid: 'DB_HYUNSUPIL', changedAt: new Date('2026-07-12T05:00:00') },
    ]);

    const map = await resolveDbPuuids(players, gameTime);
    expect(map.get(target.participantId)).toBe('DB_HYUNSUPIL');
  });

  test('게임 시각 이전에 버려진 이름은 오연결 방지 위해 매칭 안 함', async () => {
    const players = extractPlayers(realGame);
    const target = players.find((p) => p.gameName === '현수필');
    const gameTime = new Date('2026-07-11T16:42:00');

    mockModels.summoner.findAll.mockResolvedValue([]);
    // 이력상 이 이름은 게임 훨씬 전에 버려짐 → 게임 당시 주인 불명 (외부인이 쓰던 이름일 수 있음)
    mockModels.summoner_name_history.findAll.mockResolvedValue([
      { name: '현수필#KR6', puuid: 'DB_HYUNSUPIL', changedAt: new Date('2026-06-01T05:00:00') },
    ]);

    const map = await resolveDbPuuids(players, gameTime);
    expect(map.get(target.participantId)).toBe(target.puuid); // LCU 폴백 유지
  });
});

describe('healUnbridgedStats (닉변 치유)', () => {
  test('폴백 puuid(36자) 행이 있는 raw만 재처리', async () => {
    const raw = {
      id: 1,
      riotGameKey: 'KR_8294822545',
      groupId: 4,
      gameCreation: new Date(realGame.gameCreation),
      gameDuration: realGame.gameDuration,
      rawJson: realGame,
      save: jest.fn(),
    };
    const cleanRaw = { ...raw, id: 2, riotGameKey: 'KR_CLEAN', save: jest.fn() };
    mockModels.lcu_game_raw.findAll
      .mockResolvedValueOnce([{ riotGameKey: raw.riotGameKey }, { riotGameKey: cleanRaw.riotGameKey }]) // 1차: 키만
      .mockResolvedValueOnce([raw]) // 2차: 폴백 행 있는 raw만 로드
      .mockResolvedValue([]); // 이후 processRaw 내부의 usedRows 조회
    mockModels.match_player_stat.findAll.mockResolvedValueOnce([
      { riotGameKey: 'KR_8294822545', puuid: '9a9cf9e6-e43f-52aa-b0b1-000000000000' }, // 폴백 행
      { riotGameKey: 'KR_CLEAN', puuid: 'X'.repeat(78) }, // 정상 행만 → 재처리 제외
    ]);
    mockModels.match_player_stat.destroy.mockResolvedValue(1);
    mockModels.match_team_stat.destroy.mockResolvedValue(1);
    // processRaw 내부 의존성
    mockModels.summoner.findAll.mockResolvedValue(identitySummoners(realGame));
    mockModels.user.findAll.mockResolvedValue([]);
    mockModels.match.findAll.mockResolvedValue([]);
    mockModels.match_player_stat.bulkCreate.mockResolvedValue([]);
    mockModels.match_team_stat.bulkCreate.mockResolvedValue([]);

    const { healUnbridgedStats } = require('../../src/controller/lcu-collector');
    const result = await healUnbridgedStats({ withinDays: 30 });

    expect(result.checked).toBe(1);
    expect(result.healed).toBe(1);
    // 폴백 행 있는 게임만 destroy+재처리
    expect(mockModels.match_player_stat.destroy).toHaveBeenCalledTimes(1);
    expect(mockModels.match_player_stat.destroy).toHaveBeenCalledWith({
      where: { riotGameKey: 'KR_8294822545' },
    });
    expect(raw.save).toHaveBeenCalled(); // processRaw 수행됨
    expect(cleanRaw.save).not.toHaveBeenCalled();
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

    // 상세 지표 (실데이터 값)
    expect(diana.teamNo).toBe(1);
    expect(typeof diana.item0).toBe('number');
    expect(diana.champLevel).toBeGreaterThan(0);
    expect(typeof diana.runeKeystoneId).toBe('number');
    expect(diana.spell1Id).toBeGreaterThan(0);

    // 팀2 전원 승리
    const team200Rows = rows.filter((r) => team200Puuids.includes(r.puuid));
    expect(team200Rows.every((r) => r.win)).toBe(true);

    // 팀 오브젝트 스탯 2행 (firstDargon 오타 정정 포함)
    const teamRows = mockModels.match_team_stat.bulkCreate.mock.calls[0][0];
    expect(teamRows).toHaveLength(2);
    expect(teamRows.every((t) => t.matchId === 777 && t.groupId === 2)).toBe(true);
    const team2Row = teamRows.find((t) => t.teamNo === 2);
    expect(team2Row.win).toBe(true);
    expect(team2Row.firstDragon).toBe(true); // 원본 firstDargon
    expect(team2Row.bansJson).toHaveLength(5);
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

  test('한 팀 5인 중 4명 이상이 진행 중 대회 팀과 일치하면 스크림 태깅', async () => {
    const players = extractPlayers(realGame);
    // 팀100 5명 중 4명이 대회 77의 한 팀 멤버
    const team100Puuids = players.filter((p) => p.teamId === 100).map((p) => p.puuid);
    mockModels.summoner.findAll.mockResolvedValue(identitySummoners(realGame));
    mockModels.user.findAll.mockResolvedValue([]);
    mockModels.match.findAll.mockResolvedValue([]); // 봇 match 없음
    mockModels.lcu_game_raw.findAll.mockResolvedValue([]);
    mockModels.tournament.findAll.mockResolvedValue([{ id: 77, status: 'in_progress' }]);
    mockModels.tournament_team.findAll.mockResolvedValue([
      { tournamentId: 77, members: team100Puuids.slice(0, 4).map((p) => ({ puuid: p, position: 'top' })) },
    ]);
    mockModels.match_player_stat.bulkCreate.mockResolvedValue([]);
    mockModels.match_team_stat.bulkCreate.mockResolvedValue([]);

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
    expect(result.isScrim).toBe(true);
    expect(raw.isScrim).toBe(true);
    expect(raw.scrimTournamentId).toBe(77);
    const rows = mockModels.match_player_stat.bulkCreate.mock.calls[0][0];
    expect(rows.every((r) => r.isScrim === true)).toBe(true);
    // 한쪽만 대회 팀(혼성 스파링) → 상대 특정 불가라 자동 기록 없음
    expect(mockModels.tournament_scrim.create).not.toHaveBeenCalled();
  });

  test('양팀이 같은 대회의 다른 팀이면 스크림 전적 자동 기록 (승자 1:0)', async () => {
    const players = extractPlayers(realGame);
    const team100Puuids = players.filter((p) => p.teamId === 100).map((p) => p.puuid);
    const team200Puuids = players.filter((p) => p.teamId === 200).map((p) => p.puuid);
    mockModels.summoner.findAll.mockResolvedValue(identitySummoners(realGame));
    mockModels.user.findAll.mockResolvedValue([]);
    mockModels.match.findAll.mockResolvedValue([]);
    mockModels.lcu_game_raw.findAll.mockResolvedValue([]);
    mockModels.tournament.findAll.mockResolvedValue([{ id: 77, status: 'in_progress' }]);
    mockModels.tournament_team.findAll.mockResolvedValue([
      { id: 11, tournamentId: 77, members: team100Puuids.map((p) => ({ puuid: p })) },
      { id: 22, tournamentId: 77, members: team200Puuids.map((p) => ({ puuid: p })) },
    ]);
    mockModels.tournament_scrim.findOne.mockResolvedValue(null); // 기존 기록 없음
    mockModels.match_player_stat.bulkCreate.mockResolvedValue([]);
    mockModels.match_team_stat.bulkCreate.mockResolvedValue([]);

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
    expect(result.isScrim).toBe(true);
    // 실데이터: 팀200 승리 → 0:1
    expect(mockModels.tournament_scrim.create).toHaveBeenCalledWith({
      tournamentId: 77,
      team1Id: 11,
      team2Id: 22,
      team1Score: 0,
      team2Score: 1,
      recordedByDiscordId: 'collector',
      riotGameKey: 'KR_8294822545',
    });
  });

  test('같은 팀쌍 수동 기록이 게임 시각 ±24h 내에 있으면 자동 기록 생략 (수동이 정본)', async () => {
    const players = extractPlayers(realGame);
    const team100Puuids = players.filter((p) => p.teamId === 100).map((p) => p.puuid);
    const team200Puuids = players.filter((p) => p.teamId === 200).map((p) => p.puuid);
    mockModels.summoner.findAll.mockResolvedValue(identitySummoners(realGame));
    mockModels.user.findAll.mockResolvedValue([]);
    mockModels.match.findAll.mockResolvedValue([]);
    mockModels.lcu_game_raw.findAll.mockResolvedValue([]);
    mockModels.tournament.findAll.mockResolvedValue([{ id: 77, status: 'in_progress' }]);
    mockModels.tournament_team.findAll.mockResolvedValue([
      { id: 11, tournamentId: 77, members: team100Puuids.map((p) => ({ puuid: p })) },
      { id: 22, tournamentId: 77, members: team200Puuids.map((p) => ({ puuid: p })) },
    ]);
    const gameTime = new Date(realGame.gameCreation).getTime();
    mockModels.tournament_scrim.findOne.mockResolvedValue(null); // riotGameKey 멱등 체크: 없음
    // 게임 당일 저녁에 팀장이 수동으로 올린 세트
    mockModels.tournament_scrim.findAll.mockResolvedValue([
      {
        id: 9,
        recordedByDiscordId: '12345',
        team1Id: 11,
        team2Id: 22,
        createdAt: new Date(gameTime + 3 * 60 * 60 * 1000),
      },
    ]);
    mockModels.match_player_stat.bulkCreate.mockResolvedValue([]);
    mockModels.match_team_stat.bulkCreate.mockResolvedValue([]);

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
    expect(result.isScrim).toBe(true); // 태깅은 유지
    expect(mockModels.tournament_scrim.create).not.toHaveBeenCalled(); // 기록은 생략
  });

  test('preparing 대회 스크림은 태깅만 하고 기록 안 함 (팀 재편 가능성)', async () => {
    const players = extractPlayers(realGame);
    const team100Puuids = players.filter((p) => p.teamId === 100).map((p) => p.puuid);
    const team200Puuids = players.filter((p) => p.teamId === 200).map((p) => p.puuid);
    mockModels.summoner.findAll.mockResolvedValue(identitySummoners(realGame));
    mockModels.user.findAll.mockResolvedValue([]);
    mockModels.match.findAll.mockResolvedValue([]);
    mockModels.lcu_game_raw.findAll.mockResolvedValue([]);
    mockModels.tournament.findAll.mockResolvedValue([{ id: 77, status: 'preparing' }]);
    mockModels.tournament_team.findAll.mockResolvedValue([
      { id: 11, tournamentId: 77, members: team100Puuids.map((p) => ({ puuid: p })) },
      { id: 22, tournamentId: 77, members: team200Puuids.map((p) => ({ puuid: p })) },
    ]);
    mockModels.match_player_stat.bulkCreate.mockResolvedValue([]);
    mockModels.match_team_stat.bulkCreate.mockResolvedValue([]);

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
    expect(result.isScrim).toBe(true); // 태깅(통계 분리)은 유지
    expect(mockModels.tournament_scrim.create).not.toHaveBeenCalled(); // 기록은 in_progress만
  });

  test('이미 자동 기록된 게임은 재처리해도 중복 기록 안 함 (멱등)', async () => {
    const players = extractPlayers(realGame);
    const team100Puuids = players.filter((p) => p.teamId === 100).map((p) => p.puuid);
    const team200Puuids = players.filter((p) => p.teamId === 200).map((p) => p.puuid);
    mockModels.summoner.findAll.mockResolvedValue(identitySummoners(realGame));
    mockModels.user.findAll.mockResolvedValue([]);
    mockModels.match.findAll.mockResolvedValue([]);
    mockModels.lcu_game_raw.findAll.mockResolvedValue([]);
    mockModels.tournament.findAll.mockResolvedValue([{ id: 77, status: 'in_progress' }]);
    mockModels.tournament_team.findAll.mockResolvedValue([
      { id: 11, tournamentId: 77, members: team100Puuids.map((p) => ({ puuid: p })) },
      { id: 22, tournamentId: 77, members: team200Puuids.map((p) => ({ puuid: p })) },
    ]);
    mockModels.tournament_scrim.findOne.mockResolvedValue({ id: 5 }); // 이미 기록됨
    mockModels.match_player_stat.bulkCreate.mockResolvedValue([]);
    mockModels.match_team_stat.bulkCreate.mockResolvedValue([]);

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
    expect(mockModels.tournament_scrim.create).not.toHaveBeenCalled();
  });

  test('봇 match와 매핑되면 스크림 판정 없이 정규 내전', async () => {
    const players = extractPlayers(realGame);
    const match = {
      gameId: 777,
      seasonId: 3,
      gameCreation: new Date(realGame.gameCreation),
      team1: players.filter((p) => p.teamId === 100).map((p) => [p.puuid, '이름', 500, null]),
      team2: players.filter((p) => p.teamId === 200).map((p) => [p.puuid, '이름', 500, null]),
    };
    mockModels.summoner.findAll.mockResolvedValue(identitySummoners(realGame));
    mockModels.user.findAll.mockResolvedValue([]);
    mockModels.match.findAll.mockResolvedValue([match]);
    mockModels.lcu_game_raw.findAll.mockResolvedValue([]);
    mockModels.match_player_stat.bulkCreate.mockResolvedValue([]);
    mockModels.match_team_stat.bulkCreate.mockResolvedValue([]);

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
    expect(result.isScrim).toBe(false);
    expect(raw.isScrim).toBe(false);
    expect(mockModels.tournament.findAll).not.toHaveBeenCalled(); // 매핑 성공 시 판정 생략
    const rows = mockModels.match_player_stat.bulkCreate.mock.calls[0][0];
    expect(rows.every((r) => r.isScrim === false)).toBe(true);
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
