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
