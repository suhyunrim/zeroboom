/**
 * pick-users-utils 리팩토링 검증 테스트
 * DB 의존성을 모킹하여 lookupUserAndSummoner / buildFakeOptions / buildPlayerDataMap 검증
 */

jest.mock('discord.js', () => ({
  ActionRowBuilder: jest.fn(),
  ButtonBuilder: jest.fn(),
  ButtonStyle: { Primary: 1, Secondary: 2, Success: 3 },
  StringSelectMenuBuilder: jest.fn(),
  EmbedBuilder: jest.fn(),
}));

const mockModels = {
  user: { findOne: jest.fn() },
  summoner: { findOne: jest.fn() },
};

jest.mock('../../src/db/models', () => mockModels);

const {
  buildFakeOptions,
  buildPlayerDataMap,
  buildPositionOnlyOptions,
  buildTeamSelectOptions,
  applyTeamSelection,
  applyPositionPageValues,
} = require('../../src/utils/pick-users-utils');

beforeEach(() => {
  jest.resetAllMocks();
});

// 테스트용 데이터
const makeSummoner = (puuid, name, opts = {}) => ({
  puuid,
  name,
  mainPosition: opts.mainPosition || 'MIDDLE',
  subPosition: opts.subPosition || 'BOTTOM',
  mainPositionRate: opts.mainPositionRate || 50,
  subPositionRate: opts.subPositionRate || 30,
});

const makeUser = (puuid, groupId, opts = {}) => ({
  puuid,
  groupId,
  defaultRating: opts.defaultRating || 500,
  additionalRating: opts.additionalRating || 0,
  discordId: opts.discordId || null,
});

describe('buildFakeOptions', () => {
  test('discordId로 소환사명 조회 성공', async () => {
    const user = makeUser('puuid1', 1, { discordId: 'disc1' });
    const summoner = makeSummoner('puuid1', '실제소환사명');

    mockModels.user.findOne.mockResolvedValue(user);
    mockModels.summoner.findOne.mockResolvedValue(summoner);

    const result = await buildFakeOptions(
      ['파싱된닉네임'],
      [{ discordId: 'disc1' }],
      1,
      mockModels,
    );

    expect(result).toEqual([
      { name: '유저1', value: '실제소환사명', discordId: 'disc1' },
    ]);
  });

  test('discordId 없으면 parsedName 그대로 사용', async () => {
    const result = await buildFakeOptions(
      ['닉네임1'],
      [{ discordId: null }],
      1,
      mockModels,
    );

    expect(result).toEqual([
      { name: '유저1', value: '닉네임1', discordId: null },
    ]);
    expect(mockModels.user.findOne).not.toHaveBeenCalled();
  });

  test('discordId로 유저 못 찾으면 parsedName 사용 (이름 fallback 안 함)', async () => {
    mockModels.user.findOne.mockResolvedValue(null);

    const result = await buildFakeOptions(
      ['닉네임1'],
      [{ discordId: 'disc1' }],
      1,
      mockModels,
    );

    expect(result).toEqual([
      { name: '유저1', value: '닉네임1', discordId: 'disc1' },
    ]);
    // summoner.findOne은 이름 fallback으로 호출되지 않아야 함
    // (lookupUserAndSummoner에 parsedName=null로 넘기므로)
    expect(mockModels.summoner.findOne).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: '닉네임1' } }),
    );
  });

  test('여러 유저 처리', async () => {
    const user1 = makeUser('p1', 1, { discordId: 'd1' });
    const summoner1 = makeSummoner('p1', '소환사1');
    const user2 = makeUser('p2', 1, { discordId: 'd2' });
    const summoner2 = makeSummoner('p2', '소환사2');

    mockModels.user.findOne
      .mockResolvedValueOnce(user1)
      .mockResolvedValueOnce(user2);
    mockModels.summoner.findOne
      .mockResolvedValueOnce(summoner1)
      .mockResolvedValueOnce(summoner2);

    const result = await buildFakeOptions(
      ['닉1', '닉2'],
      [{ discordId: 'd1' }, { discordId: 'd2' }],
      1,
      mockModels,
    );

    expect(result).toHaveLength(2);
    expect(result[0].value).toBe('소환사1');
    expect(result[1].value).toBe('소환사2');
  });

  test('pickedMembersData가 null이면 전부 parsedName 사용', async () => {
    const result = await buildFakeOptions(
      ['닉1', '닉2'],
      null,
      1,
      mockModels,
    );

    expect(result).toEqual([
      { name: '유저1', value: '닉1', discordId: null },
      { name: '유저2', value: '닉2', discordId: null },
    ]);
  });
});

describe('buildPlayerDataMap', () => {
  test('discordId로 조회 성공 → playerDataMap + fakeOptions 생성', async () => {
    const user = makeUser('p1', 1, { discordId: 'd1', defaultRating: 600, additionalRating: 20 });
    const summoner = makeSummoner('p1', '소환사1', {
      mainPosition: 'UTILITY',
      subPosition: 'BOTTOM',
      mainPositionRate: 45,
      subPositionRate: 25,
    });

    mockModels.user.findOne.mockResolvedValue(user);
    mockModels.summoner.findOne.mockResolvedValue(summoner);

    const { playerDataMap, fakeOptions, error } = await buildPlayerDataMap(
      ['닉1'],
      [{ discordId: 'd1' }],
      1,
      mockModels,
    );

    expect(error).toBeNull();
    expect(fakeOptions).toEqual([
      { name: '유저1', value: '소환사1', discordId: 'd1' },
    ]);
    expect(playerDataMap['소환사1']).toEqual({
      puuid: 'p1',
      name: '소환사1',
      rating: 620,
      discordId: 'd1',
      mainPos: 'SUPPORT', // UTILITY → SUPPORT 변환 확인
      subPos: 'BOTTOM',
      mainPositionRate: 45,
      subPositionRate: 25,
    });
  });

  test('discordId 실패 → 이름 fallback 조회', async () => {
    const summoner = makeSummoner('p1', '닉1');
    const user = makeUser('p1', 1, { defaultRating: 500, additionalRating: 0 });

    // discordId 조회 실패
    mockModels.user.findOne
      .mockResolvedValueOnce(null)
      // 이름 fallback으로 user 조회
      .mockResolvedValueOnce(user);
    mockModels.summoner.findOne
      // 이름으로 summoner 조회
      .mockResolvedValueOnce(summoner);

    const { playerDataMap, error } = await buildPlayerDataMap(
      ['닉1'],
      [{ discordId: 'd1' }],
      1,
      mockModels,
    );

    expect(error).toBeNull();
    expect(playerDataMap['닉1']).toBeDefined();
    expect(playerDataMap['닉1'].rating).toBe(500);
  });

  test('유저 정보 못 찾으면 에러 반환', async () => {
    mockModels.user.findOne.mockResolvedValue(null);
    mockModels.summoner.findOne.mockResolvedValue(null);

    const { playerDataMap, fakeOptions, error } = await buildPlayerDataMap(
      ['없는유저'],
      [{ discordId: 'd1' }],
      1,
      mockModels,
    );

    expect(error).toContain('미등록 유저');
    expect(playerDataMap).toBeNull();
    expect(fakeOptions).toBeNull();
  });

  test('여러 유저 중 하나라도 못 찾으면 에러', async () => {
    const user1 = makeUser('p1', 1, { discordId: 'd1' });
    const summoner1 = makeSummoner('p1', '소환사1');

    mockModels.user.findOne
      .mockResolvedValueOnce(user1)
      .mockResolvedValueOnce(null); // 두 번째 유저 실패
    mockModels.summoner.findOne
      .mockResolvedValueOnce(summoner1)
      .mockResolvedValueOnce(null);

    const { error, unregisteredDiscordIds } = await buildPlayerDataMap(
      ['닉1', '없는유저'],
      [{ discordId: 'd1' }, { discordId: 'd2' }],
      1,
      mockModels,
    );

    expect(error).toContain('미등록 유저');
    expect(unregisteredDiscordIds).toContain('d2');
  });
});

describe('buildPositionOnlyOptions', () => {
  test('6개 옵션(탑/정글/미드/원딜/서폿/상관X) + 이모지 라벨', () => {
    const opts = buildPositionOnlyOptions('탑');
    expect(opts.map((o) => o.value)).toEqual(['탑', '정글', '미드', '원딜', '서폿', '상관X']);
    expect(opts[0].label).toBe('⚔️ 탑');
    expect(opts[5].label).toBe('🎲 상관없음'); // 상관X는 "상관없음"으로 표기
  });

  test('현재 포지션만 default=true', () => {
    const opts = buildPositionOnlyOptions('미드');
    const defaults = opts.filter((o) => o.default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].value).toBe('미드');
  });
});

describe('buildTeamSelectOptions', () => {
  const pickedUsers = ['닉A', '닉B', '닉C', '닉D'];

  test('value=인덱스, 라벨=번호+닉네임', () => {
    const positionData = {};
    pickedUsers.forEach((n) => { positionData[n] = { team: '랜덤팀', position: '상관X' }; });
    const opts = buildTeamSelectOptions(pickedUsers, positionData, 2);
    expect(opts.map((o) => o.value)).toEqual(['0', '1', '2', '3']);
    expect(opts[0].label).toBe('1. 닉A');
    expect(opts.every((o) => !o.default)).toBe(true);
  });

  test('현재 1팀 유저를 default로, teamSize까지만', () => {
    const positionData = {
      '닉A': { team: '1팀', position: '탑' },
      '닉B': { team: '1팀', position: '정글' },
      '닉C': { team: '1팀', position: '미드' }, // teamSize=2 초과분
      '닉D': { team: '2팀', position: '원딜' },
    };
    const opts = buildTeamSelectOptions(pickedUsers, positionData, 2);
    expect(opts.filter((o) => o.default).map((o) => o.value)).toEqual(['0', '1']);
  });
});

describe('applyTeamSelection', () => {
  const pickedUsers = ['닉A', '닉B', '닉C', '닉D'];

  test('선택 인덱스=1팀, 나머지=2팀, 포지션은 유지', () => {
    const positionData = {
      '닉A': { team: '랜덤팀', position: '탑' },
      '닉B': { team: '랜덤팀', position: '정글' },
      '닉C': { team: '랜덤팀', position: '미드' },
      '닉D': { team: '랜덤팀', position: '원딜' },
    };
    applyTeamSelection(positionData, pickedUsers, ['0', '2']);
    expect(positionData['닉A']).toEqual({ team: '1팀', position: '탑' });
    expect(positionData['닉C']).toEqual({ team: '1팀', position: '미드' });
    expect(positionData['닉B']).toEqual({ team: '2팀', position: '정글' });
    expect(positionData['닉D']).toEqual({ team: '2팀', position: '원딜' });
  });
});

describe('applyPositionPageValues', () => {
  const pickedUsers = ['닉A', '닉B', '닉C', '닉D', '닉E', '닉F'];

  const makeData = () => {
    const d = {};
    pickedUsers.forEach((n) => { d[n] = { team: '1팀', position: '상관X' }; });
    return d;
  };

  test('인덱스 기준으로 포지션만 반영, 팀은 유지', () => {
    const positionData = makeData();
    applyPositionPageValues(positionData, pickedUsers, { 0: '탑', 2: '서폿' });
    expect(positionData['닉A']).toEqual({ team: '1팀', position: '탑' });
    expect(positionData['닉C']).toEqual({ team: '1팀', position: '서폿' });
    // 언급되지 않은 유저는 그대로
    expect(positionData['닉B']).toEqual({ team: '1팀', position: '상관X' });
  });

  test('두 번째 페이지 인덱스(5~)도 정상 반영', () => {
    const positionData = makeData();
    applyPositionPageValues(positionData, pickedUsers, { 5: '미드' });
    expect(positionData['닉F']).toEqual({ team: '1팀', position: '미드' });
  });

  test('빈 값/범위 밖 인덱스는 무시', () => {
    const positionData = makeData();
    applyPositionPageValues(positionData, pickedUsers, { 0: '', 99: '탑' });
    expect(positionData['닉A']).toEqual({ team: '1팀', position: '상관X' });
  });
});
