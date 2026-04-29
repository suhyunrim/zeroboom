const mockTransaction = {
  commit: jest.fn(),
  rollback: jest.fn(),
};

const mockModels = {
  sequelize: {
    transaction: jest.fn().mockResolvedValue(mockTransaction),
    query: jest.fn().mockResolvedValue([]),
  },
  group: {
    findByPk: jest.fn(),
  },
  user: {
    findAll: jest.fn(),
  },
  season_snapshot: {
    bulkCreate: jest.fn(),
  },
  notification: {
    create: jest.fn().mockResolvedValue(null),
    bulkCreate: jest.fn().mockResolvedValue([]),
  },
};

jest.mock('../../src/db/models', () => mockModels);
jest.mock('../../src/controller/audit-log', () => ({
  log: jest.fn(),
}));

const { resetSeason } = require('../../src/controller/season');
const auditLog = require('../../src/controller/audit-log');

describe('season.resetSeason', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockModels.sequelize.transaction.mockResolvedValue(mockTransaction);
  });

  const makeGroup = (currentSeason = 1) => ({
    id: 1,
    settings: { currentSeason },
    update: jest.fn().mockResolvedValue(true),
  });

  const makeUsers = () => [
    { puuid: 'p1', defaultRating: 1000, additionalRating: 200, discordId: 'd1' },
    { puuid: 'p2', defaultRating: 1000, additionalRating: -100, discordId: 'd2' },
    { puuid: 'p3', defaultRating: 1000, additionalRating: 0, discordId: 'd3' },
  ];

  test('스냅샷 저장 후 additionalRating 반감, 시즌 증가', async () => {
    const group = makeGroup(1);
    const users = makeUsers();
    mockModels.group.findByPk.mockResolvedValue(group);
    mockModels.user.findAll.mockResolvedValue(users);

    const result = await resetSeason(1, 'actor1', 'TestActor');

    // 스냅샷 저장 확인
    expect(mockModels.season_snapshot.bulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ puuid: 'p1', season: 1, additionalRating: 200 }),
        expect.objectContaining({ puuid: 'p2', season: 1, additionalRating: -100 }),
        expect.objectContaining({ puuid: 'p3', season: 1, additionalRating: 0 }),
      ]),
      { transaction: mockTransaction },
    );

    // SQL 일괄 업데이트 확인
    expect(mockModels.sequelize.query).toHaveBeenCalledWith(
      'UPDATE users SET additionalRating = FLOOR(additionalRating / 2) WHERE groupId = ?',
      {
        replacements: [1],
        transaction: mockTransaction,
      },
    );

    // currentSeason 증가 확인
    expect(group.update).toHaveBeenCalledWith({ settings: { currentSeason: 2 } }, { transaction: mockTransaction });

    // 트랜잭션 커밋 확인
    expect(mockTransaction.commit).toHaveBeenCalled();
    expect(mockTransaction.rollback).not.toHaveBeenCalled();

    // 결과 확인
    expect(result).toEqual({ fromSeason: 1, toSeason: 2, usersAffected: 3 });
  });

  test('감사 로그 기록', async () => {
    mockModels.group.findByPk.mockResolvedValue(makeGroup(2));
    mockModels.user.findAll.mockResolvedValue(makeUsers());

    await resetSeason(1, 'actor1', 'TestActor');

    expect(auditLog.log).toHaveBeenCalledWith({
      groupId: 1,
      actorDiscordId: 'actor1',
      actorName: 'TestActor',
      action: 'season.reset',
      details: { fromSeason: 2, toSeason: 3, usersAffected: 3 },
      source: 'discord',
    });
  });

  test('settings가 null이면 currentSeason을 1로 처리', async () => {
    const group = { id: 1, settings: null, update: jest.fn().mockResolvedValue(true) };
    mockModels.group.findByPk.mockResolvedValue(group);
    mockModels.user.findAll.mockResolvedValue([]);

    const result = await resetSeason(1, 'actor1', 'TestActor');

    expect(result.fromSeason).toBe(1);
    expect(result.toSeason).toBe(2);
  });

  test('에러 발생 시 롤백', async () => {
    mockModels.group.findByPk.mockResolvedValue(makeGroup(1));
    mockModels.user.findAll.mockRejectedValue(new Error('DB error'));

    await expect(resetSeason(1, 'actor1', 'TestActor')).rejects.toThrow('DB error');

    expect(mockTransaction.rollback).toHaveBeenCalled();
    expect(mockTransaction.commit).not.toHaveBeenCalled();
  });
});
