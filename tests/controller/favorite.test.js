const mockModels = {
  user: {
    findOne: jest.fn(),
  },
  user_favorite: {
    findAll: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
  },
};

jest.mock('../../src/db/models', () => mockModels);

const favoriteController = require('../../src/controller/favorite');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('add', () => {
  const input = { groupId: 1, ownerDiscordId: 'D1', targetPuuid: 'P1' };

  test('대상이 그룹에 없으면(또는 부캐면) 에러', async () => {
    mockModels.user.findOne.mockResolvedValue(null);
    const r = await favoriteController.add(input);
    expect(r.error).toBeDefined();
    expect(mockModels.user.findOne).toHaveBeenCalledWith({
      where: { groupId: 1, puuid: 'P1', primaryPuuid: null },
    });
    expect(mockModels.user_favorite.create).not.toHaveBeenCalled();
  });

  test('10명 도달 시 에러', async () => {
    mockModels.user.findOne.mockResolvedValue({ puuid: 'P1' });
    mockModels.user_favorite.count.mockResolvedValue(favoriteController.MAX_FAVORITES);
    const r = await favoriteController.add(input);
    expect(r.error).toContain('최대');
    expect(mockModels.user_favorite.create).not.toHaveBeenCalled();
  });

  test('정상 등록', async () => {
    mockModels.user.findOne.mockResolvedValue({ puuid: 'P1' });
    mockModels.user_favorite.count.mockResolvedValue(3);
    mockModels.user_favorite.create.mockResolvedValue({ id: 7 });
    const r = await favoriteController.add(input);
    expect(r.favorite).toEqual({ id: 7 });
    expect(mockModels.user_favorite.create).toHaveBeenCalledWith({
      groupId: 1,
      ownerDiscordId: 'D1',
      targetPuuid: 'P1',
    });
  });

  test('중복(unique 충돌)은 에러 메시지로 변환', async () => {
    mockModels.user.findOne.mockResolvedValue({ puuid: 'P1' });
    mockModels.user_favorite.count.mockResolvedValue(3);
    const err = new Error('dup');
    err.name = 'SequelizeUniqueConstraintError';
    mockModels.user_favorite.create.mockRejectedValue(err);
    const r = await favoriteController.add(input);
    expect(r.error).toContain('이미');
  });

  test('그 외 DB 에러는 그대로 throw', async () => {
    mockModels.user.findOne.mockResolvedValue({ puuid: 'P1' });
    mockModels.user_favorite.count.mockResolvedValue(3);
    mockModels.user_favorite.create.mockRejectedValue(new Error('db fail'));
    await expect(favoriteController.add(input)).rejects.toThrow('db fail');
  });
});

describe('getList', () => {
  test('본인 것만 등록순으로 조회', async () => {
    mockModels.user_favorite.findAll.mockResolvedValue([]);
    await favoriteController.getList({ groupId: 1, ownerDiscordId: 'D1' });
    expect(mockModels.user_favorite.findAll).toHaveBeenCalledWith({
      where: { groupId: 1, ownerDiscordId: 'D1' },
      order: [['id', 'ASC']],
    });
  });
});

describe('remove', () => {
  test('본인 소유 조건으로 destroy 호출', async () => {
    mockModels.user_favorite.destroy.mockResolvedValue(1);
    const r = await favoriteController.remove({
      groupId: 1,
      ownerDiscordId: 'D1',
      targetPuuid: 'P1',
    });
    expect(r).toBe(1);
    expect(mockModels.user_favorite.destroy).toHaveBeenCalledWith({
      where: { groupId: 1, ownerDiscordId: 'D1', targetPuuid: 'P1' },
    });
  });
});
