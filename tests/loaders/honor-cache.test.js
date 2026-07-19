// Redis 클라이언트를 인메모리로 대체해 백스토어 동작(저장/삭제/스캔·TTL 인자)을 검증한다
const store = new Map();
const mockClient = {
  set: jest.fn(async (key, value) => { store.set(key, value); }),
  get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
  del: jest.fn(async (key) => { store.delete(key); }),
  scanIterator: ({ MATCH }) => {
    const prefix = MATCH.replace('*', '');
    const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
    return (async function* iterate() { yield* keys; })();
  },
};
let mockReady = true;
jest.mock('../../src/redis/redis', () => ({ client: mockClient, isReady: () => mockReady }));
jest.mock('../../src/loaders/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const honorCache = require('../../src/redis/honor-cache');

const sampleSession = (gameId) => ({
  gameId,
  groupId: 4,
  team1: [{ puuid: 'a', name: 'A' }],
  team2: [{ puuid: 'b', name: 'B' }],
  category: { emoji: '🏆', label: 'MVP', question: '최고는?' },
  channelId: 'ch1',
  messageId: 'msg1',
  expiresAt: Date.now() + 1000,
});

beforeEach(() => {
  store.clear();
  mockReady = true;
  jest.clearAllMocks();
});

describe('honor-cache', () => {
  it('저장한 세션을 gameId로 되찾는다 (TTL 지정 포함)', async () => {
    await honorCache.saveSession(2124, sampleSession(2124), 43200);
    expect(mockClient.set).toHaveBeenCalledWith('honorVote:2124', expect.any(String), { EX: 43200 });
    const loaded = await honorCache.getSession(2124);
    expect(loaded.gameId).toBe(2124);
    expect(loaded.channelId).toBe('ch1');
  });

  it('삭제하면 조회되지 않는다', async () => {
    await honorCache.saveSession(2124, sampleSession(2124), 100);
    await honorCache.deleteSession(2124);
    expect(await honorCache.getSession(2124)).toBeNull();
  });

  it('listSessions는 남아있는 세션 전체를 돌려준다 (부팅 복원용)', async () => {
    await honorCache.saveSession(1, sampleSession(1), 100);
    await honorCache.saveSession(2, sampleSession(2), 100);
    store.set('other:key', 'x'); // 다른 프리픽스는 스캔에 걸리면 안 된다
    const all = await honorCache.listSessions();
    expect(all.map((s) => s.gameId).sort()).toEqual([1, 2]);
  });

  it('Redis 미연결이면 조용히 no-op (봇 기능은 인메모리로 계속)', async () => {
    mockReady = false;
    await honorCache.saveSession(1, sampleSession(1), 100);
    expect(await honorCache.getSession(1)).toBeNull();
    expect(await honorCache.listSessions()).toEqual([]);
    expect(mockClient.set).not.toHaveBeenCalled();
  });
});
