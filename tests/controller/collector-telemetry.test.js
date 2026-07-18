const mockModels = {
  collector_install: { findOrCreate: jest.fn(), findAll: jest.fn() },
  collector_telemetry_event: { bulkCreate: jest.fn(), findAll: jest.fn() },
};
jest.mock('../../src/db/models', () => mockModels);
jest.mock('../../src/loaders/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const {
  recordEvents,
  listInstalls,
  deriveStatus,
  normalizeEvents,
} = require('../../src/controller/collector-telemetry');

// findOrCreate가 기존 행을 돌려주는 상황 (created=false)
const existingInstall = (fields = {}) => {
  const instance = { installId: 'inst-1', update: jest.fn(), ...fields };
  mockModels.collector_install.findOrCreate.mockResolvedValue([instance, false]);
  return instance;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockModels.collector_telemetry_event.bulkCreate.mockResolvedValue([]);
});

describe('normalizeEvents', () => {
  it('알 수 없는 타입은 버리고 시각순으로 정렬한다', () => {
    const events = normalizeEvents(
      [
        { type: 'quit', occurredAt: '2026-07-18T10:00:00Z' },
        { type: '해킹', occurredAt: '2026-07-18T09:00:00Z' },
        { type: 'start', occurredAt: '2026-07-18T09:30:00Z' },
      ],
      {},
    );
    expect(events.map((e) => e.type)).toEqual(['start', 'quit']);
  });

  it('과도한 길이는 잘라내고 개수는 50개로 제한한다', () => {
    const events = normalizeEvents(
      Array.from({ length: 80 }, () => ({ type: 'crash', message: 'x'.repeat(9000) })),
      {},
    );
    expect(events).toHaveLength(50);
    expect(events[0].message).toHaveLength(4000);
  });
});

describe('recordEvents', () => {
  it('installId가 없으면 거절한다', async () => {
    expect(await recordEvents({ events: [{ type: 'start' }] })).toEqual({
      status: 'rejected',
      reason: 'installId 없음',
    });
  });

  it('heartbeat는 이력으로 저장하지 않고 상태만 갱신한다', async () => {
    const install = existingInstall();
    const result = await recordEvents({
      installId: 'inst-1',
      events: [
        {
          type: 'heartbeat',
          occurredAt: '2026-07-18T10:00:00Z',
          lcuConnected: true,
          lastUploadAt: '2026-07-18T09:50:00Z',
        },
      ],
    });

    expect(result).toEqual({ status: 'ok', accepted: 1, stored: 0 });
    expect(mockModels.collector_telemetry_event.bulkCreate).not.toHaveBeenCalled();
    const patch = install.update.mock.calls[0][0];
    expect(patch.lastHeartbeatAt).toEqual(new Date('2026-07-18T10:00:00Z'));
    expect(patch.lcuConnected).toBe(true);
    expect(patch.lastUploadAt).toEqual(new Date('2026-07-18T09:50:00Z'));
  });

  it('종료 사유를 기록한다 (사용자 종료 vs 업데이트 재시작 구분)', async () => {
    const install = existingInstall();
    await recordEvents({
      installId: 'inst-1',
      events: [{ type: 'quit', reason: 'user_quit', occurredAt: '2026-07-18T10:00:00Z' }],
    });

    expect(install.update.mock.calls[0][0].lastQuitReason).toBe('user_quit');
    expect(mockModels.collector_telemetry_event.bulkCreate).toHaveBeenCalledWith([
      expect.objectContaining({ installId: 'inst-1', type: 'quit', reason: 'user_quit' }),
    ]);
  });

  it('큐에 밀렸다 몰려온 이벤트를 시각순으로 접는다 (마지막 상태가 이김)', async () => {
    const install = existingInstall();
    await recordEvents({
      installId: 'inst-1',
      version: '0.2.6',
      events: [
        { type: 'quit', reason: 'update_restart', occurredAt: '2026-07-18T05:14:00Z' },
        { type: 'start', occurredAt: '2026-07-18T05:15:00Z' },
        { type: 'crash', message: 'boom', occurredAt: '2026-07-18T05:41:00Z' },
      ],
    });

    const patch = install.update.mock.calls[0][0];
    expect(patch.lastQuitAt).toEqual(new Date('2026-07-18T05:14:00Z'));
    expect(patch.lastCrashAt).toEqual(new Date('2026-07-18T05:41:00Z'));
    expect(patch.lastCrashMessage).toBe('boom');
    expect(patch.version).toBe('0.2.6');
    expect(mockModels.collector_telemetry_event.bulkCreate.mock.calls[0][0]).toHaveLength(3);
  });

  it('뒤늦게 도착한 과거 이벤트가 최신 시각을 되돌리지 않는다', async () => {
    const install = existingInstall({ lastEventAt: new Date('2026-07-18T12:00:00Z') });
    await recordEvents({
      installId: 'inst-1',
      events: [{ type: 'start', occurredAt: '2026-07-18T05:00:00Z' }],
    });

    expect(install.update.mock.calls[0][0].lastEventAt).toBeUndefined();
  });
});

describe('deriveStatus', () => {
  const now = new Date('2026-07-18T18:00:00Z').getTime();

  it('하트비트가 최근이면 running', () => {
    const install = { lastHeartbeatAt: new Date('2026-07-18T17:50:00Z'), lastEventAt: null };
    expect(deriveStatus(install, now)).toBe('running');
  });

  it('신호가 끊겼고 마지막 말이 종료였으면 quit', () => {
    const at = new Date('2026-07-18T05:41:00Z');
    expect(deriveStatus({ lastHeartbeatAt: at, lastEventAt: at, lastQuitAt: at }, now)).toBe('quit');
  });

  it('신호가 끊겼고 마지막 말이 크래시였으면 crashed', () => {
    const at = new Date('2026-07-18T05:41:00Z');
    expect(deriveStatus({ lastHeartbeatAt: at, lastEventAt: at, lastCrashAt: at }, now)).toBe(
      'crashed',
    );
  });

  it('아무 말 없이 사라졌으면 stale (강제 종료·전원 차단)', () => {
    const at = new Date('2026-07-18T05:41:00Z');
    expect(deriveStatus({ lastHeartbeatAt: at, lastEventAt: at }, now)).toBe('stale');
  });
});

describe('listInstalls', () => {
  it('설치별 상태를 판정해 돌려준다', async () => {
    mockModels.collector_install.findAll.mockResolvedValue([
      {
        installId: 'inst-1',
        riotId: '강빈 공듀#최강귀요미',
        version: '0.2.4',
        platform: 'win32',
        lastHeartbeatAt: new Date(Date.now() - 10 * 60 * 1000),
        lastEventAt: new Date(Date.now() - 10 * 60 * 1000),
        lcuConnected: true,
        lastScanAt: null,
        lastUploadAt: null,
        lastQuitAt: null,
        lastQuitReason: null,
        lastCrashAt: null,
        lastCrashMessage: null,
      },
    ]);

    const [install] = await listInstalls();
    expect(install.riotId).toBe('강빈 공듀#최강귀요미');
    expect(install.status).toBe('running');
    expect(install.lcuConnected).toBe(true);
  });

  it('멈춘 설치의 LCU 연결 상태는 마지막 값에 고정되지 않는다', async () => {
    const at = new Date('2026-07-18T05:41:00Z');
    mockModels.collector_install.findAll.mockResolvedValue([
      {
        installId: 'inst-1',
        lastHeartbeatAt: at,
        lastEventAt: at,
        lastCrashAt: at,
        lcuConnected: true, // 크래시 당시 연결돼 있었다
      },
    ]);

    const [install] = await listInstalls();
    expect(install.status).toBe('crashed');
    expect(install.lcuConnected).toBe(false);
  });
});
