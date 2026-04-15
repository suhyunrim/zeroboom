const mockModels = {
  group: { findOne: jest.fn() },
  user: { findOne: jest.fn() },
};

jest.mock('../../src/db/models', () => mockModels);
jest.mock('../../src/controller/season', () => ({
  resetSeason: jest.fn(),
}));

const { run } = require('../../src/commands/season-reset');
const seasonController = require('../../src/controller/season');

describe('시즌초기화 명령어', () => {
  const makeInteraction = (discordId = 'user1') => ({
    guildId: 'guild1',
    user: { id: discordId, username: 'TestUser' },
    member: { nickname: 'TestNick' },
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('그룹이 없으면 에러 메시지', async () => {
    mockModels.group.findOne.mockResolvedValue(null);

    const result = await run('test', makeInteraction());

    expect(result).toBe('그룹을 찾을 수 없습니다.');
  });

  test('관리자가 아니면 에러 메시지', async () => {
    mockModels.group.findOne.mockResolvedValue({ id: 1 });
    mockModels.user.findOne.mockResolvedValue({ role: 'member' });

    const result = await run('test', makeInteraction());

    expect(result).toBe('관리자만 시즌 초기화를 할 수 있습니다.');
  });

  test('유저가 없으면 에러 메시지', async () => {
    mockModels.group.findOne.mockResolvedValue({ id: 1 });
    mockModels.user.findOne.mockResolvedValue(null);

    const result = await run('test', makeInteraction());

    expect(result).toBe('관리자만 시즌 초기화를 할 수 있습니다.');
  });

  test('관리자면 시즌 초기화 실행', async () => {
    mockModels.group.findOne.mockResolvedValue({ id: 1 });
    mockModels.user.findOne.mockResolvedValue({ role: 'admin' });
    seasonController.resetSeason.mockResolvedValue({
      fromSeason: 1,
      toSeason: 2,
      usersAffected: 5,
    });

    const result = await run('test', makeInteraction());

    expect(seasonController.resetSeason).toHaveBeenCalledWith(1, 'user1', 'TestNick');
    expect(result).toBe('시즌 1 종료! 시즌 2 시작. (5명 레이팅 소프트 리셋 완료)');
  });

  test('닉네임 없으면 username 사용', async () => {
    mockModels.group.findOne.mockResolvedValue({ id: 1 });
    mockModels.user.findOne.mockResolvedValue({ role: 'admin' });
    seasonController.resetSeason.mockResolvedValue({
      fromSeason: 1,
      toSeason: 2,
      usersAffected: 3,
    });

    const interaction = makeInteraction();
    interaction.member.nickname = null;

    await run('test', interaction);

    expect(seasonController.resetSeason).toHaveBeenCalledWith(1, 'user1', 'TestUser');
  });

  test('resetSeason 에러 시 에러 메시지 반환', async () => {
    mockModels.group.findOne.mockResolvedValue({ id: 1 });
    mockModels.user.findOne.mockResolvedValue({ role: 'admin' });
    seasonController.resetSeason.mockRejectedValue(new Error('DB error'));

    const result = await run('test', makeInteraction());

    expect(result).toBe('시즌 초기화 중 오류가 발생했습니다.');
  });
});
