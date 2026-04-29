const mockModels = {
  notification: {
    create: jest.fn(),
    bulkCreate: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../src/db/models', () => mockModels);
jest.mock('../../src/loaders/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const notificationController = require('../../src/controller/notification');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildTextPreview', () => {
  test('빈 입력은 빈 문자열', () => {
    expect(notificationController.buildTextPreview('')).toBe('');
    expect(notificationController.buildTextPreview(null)).toBe('');
  });

  test('짧은 텍스트는 그대로', () => {
    expect(notificationController.buildTextPreview('안녕하세요')).toBe('안녕하세요');
  });

  test('긴 텍스트는 잘리고 … 추가', () => {
    const long = 'a'.repeat(100);
    const out = notificationController.buildTextPreview(long, 10);
    expect(out).toBe(`${'a'.repeat(10)}…`);
  });

  test('연속 공백/개행은 하나로 합쳐짐', () => {
    expect(notificationController.buildTextPreview('hello\n\nworld   !')).toBe('hello world !');
  });
});

describe('create', () => {
  test('actor === recipient면 생성 안 함', async () => {
    const r = await notificationController.create({
      recipientDiscordId: 'A',
      actorDiscordId: 'A',
      type: 'guestbook_like',
    });
    expect(r).toBeNull();
    expect(mockModels.notification.create).not.toHaveBeenCalled();
  });

  test('필수 필드 빠지면 null', async () => {
    expect(await notificationController.create({ type: 'guestbook_like' })).toBeNull();
    expect(await notificationController.create({ recipientDiscordId: 'A' })).toBeNull();
  });

  test('정상 케이스는 모델 create 호출', async () => {
    mockModels.notification.create.mockResolvedValue({ id: 1 });
    await notificationController.create({
      recipientDiscordId: 'B',
      actorDiscordId: 'A',
      type: 'guestbook_comment',
      payload: { foo: 'bar' },
    });
    expect(mockModels.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientDiscordId: 'B',
        actorDiscordId: 'A',
        type: 'guestbook_comment',
      }),
    );
  });

  test('DB 에러는 swallow하고 null 반환', async () => {
    mockModels.notification.create.mockRejectedValue(new Error('db fail'));
    const r = await notificationController.create({
      recipientDiscordId: 'B',
      actorDiscordId: 'A',
      type: 'guestbook_like',
    });
    expect(r).toBeNull();
  });
});

describe('createBulk', () => {
  test('빈 배열 입력은 즉시 빈 배열 반환', async () => {
    const r = await notificationController.createBulk({
      recipientDiscordIds: [],
      type: 'season_end',
    });
    expect(r).toEqual([]);
    expect(mockModels.notification.bulkCreate).not.toHaveBeenCalled();
  });

  test('actor 자기 자신은 자동 제외', async () => {
    mockModels.notification.bulkCreate.mockResolvedValue([{ id: 1 }]);
    await notificationController.createBulk({
      recipientDiscordIds: ['A', 'B', 'C'],
      actorDiscordId: 'B',
      type: 'guestbook_reply',
    });
    const call = mockModels.notification.bulkCreate.mock.calls[0][0];
    expect(call.length).toBe(2);
    expect(call.map((r) => r.recipientDiscordId)).toEqual(['A', 'C']);
  });
});

describe('groupNotifications', () => {
  const makeRow = (id, type, targetKey, actor, readAt = null, createdAt = '2026-04-29T10:00:00Z') => ({
    id,
    type,
    targetKey,
    groupId: 1,
    actorDiscordId: actor,
    actorName: actor ? `${actor}_name` : null,
    payload: { textPreview: '...' },
    readAt,
    createdAt,
  });

  test('targetKey 같은 알림은 한 그룹으로 묶임', () => {
    const rows = [
      makeRow(3, 'guestbook_like', 'like:1', 'X', null, '2026-04-29T12:00:00Z'),
      makeRow(2, 'guestbook_like', 'like:1', 'Y', null, '2026-04-29T11:00:00Z'),
      makeRow(1, 'guestbook_like', 'like:1', 'Z', null, '2026-04-29T10:00:00Z'),
    ];
    const groups = notificationController.groupNotifications(rows);
    expect(groups.length).toBe(1);
    expect(groups[0].count).toBe(3);
    expect(groups[0].actors.map((a) => a.discordId)).toEqual(['X', 'Y', 'Z']);
  });

  test('targetKey 없으면 개별 그룹', () => {
    const rows = [makeRow(1, 'guestbook_comment', null, 'A'), makeRow(2, 'guestbook_comment', null, 'B')];
    const groups = notificationController.groupNotifications(rows);
    expect(groups.length).toBe(2);
  });

  test('hasUnread는 그룹 내 readAt null 하나라도 있으면 true', () => {
    const rows = [
      makeRow(1, 'guestbook_like', 'like:1', 'X', new Date()),
      makeRow(2, 'guestbook_like', 'like:1', 'Y', null),
    ];
    const groups = notificationController.groupNotifications(rows);
    expect(groups[0].hasUnread).toBe(true);
  });

  test('모든 row가 read 상태면 hasUnread false', () => {
    const rows = [
      makeRow(1, 'guestbook_like', 'like:1', 'X', new Date()),
      makeRow(2, 'guestbook_like', 'like:1', 'Y', new Date()),
    ];
    const groups = notificationController.groupNotifications(rows);
    expect(groups[0].hasUnread).toBe(false);
  });

  test('actor 샘플은 최대 3명, 중복 액터는 한 번만', () => {
    const rows = [
      makeRow(1, 'guestbook_like', 'like:1', 'X'),
      makeRow(2, 'guestbook_like', 'like:1', 'Y'),
      makeRow(3, 'guestbook_like', 'like:1', 'Z'),
      makeRow(4, 'guestbook_like', 'like:1', 'W'),
      makeRow(5, 'guestbook_like', 'like:1', 'X'), // 중복
    ];
    const groups = notificationController.groupNotifications(rows);
    expect(groups[0].actors.length).toBe(3);
    expect(groups[0].count).toBe(5);
  });

  test('그룹 정렬은 latestAt DESC', () => {
    const rows = [
      makeRow(1, 'guestbook_comment', null, 'A', null, '2026-04-29T10:00:00Z'),
      makeRow(2, 'guestbook_like', 'like:5', 'B', null, '2026-04-29T15:00:00Z'),
      makeRow(3, 'guestbook_comment', null, 'C', null, '2026-04-29T12:00:00Z'),
    ];
    const groups = notificationController.groupNotifications(rows);
    expect(groups.map((g) => g.items[0].id)).toEqual([2, 3, 1]);
  });
});
