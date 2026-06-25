const rl = require('../../../src/api/middlewares/ai-rate-limit');

const DAY = 24 * 60 * 60 * 1000;

describe('ai-rate-limit (인당 일일 호출 제한)', () => {
  beforeEach(() => rl._reset());

  test('한도까지 통과하고 초과분은 막는다(증가 없음)', () => {
    const now = Date.UTC(2026, 5, 25, 3, 0, 0); // 임의 시각
    const r1 = rl.consume('puuidA', now, 3);
    const r2 = rl.consume('puuidA', now, 3);
    const r3 = rl.consume('puuidA', now, 3);
    const r4 = rl.consume('puuidA', now, 3);

    expect(r1).toMatchObject({ ok: true, used: 1, remaining: 2, limit: 3 });
    expect(r2).toMatchObject({ ok: true, used: 2, remaining: 1 });
    expect(r3).toMatchObject({ ok: true, used: 3, remaining: 0 });
    expect(r4).toMatchObject({ ok: false, used: 3, remaining: 0 }); // 초과: count 그대로 3
  });

  test('유저(puuid)별로 카운트가 독립적이다', () => {
    const now = Date.UTC(2026, 5, 25, 3, 0, 0);
    rl.consume('puuidA', now, 1);
    const a2 = rl.consume('puuidA', now, 1);
    const b1 = rl.consume('puuidB', now, 1);

    expect(a2.ok).toBe(false);
    expect(b1.ok).toBe(true);
  });

  test('KST 자정이 지나면 리셋된다', () => {
    const limit = 1;
    // KST 2026-06-25 23:00 == UTC 14:00 (전날 아님, 같은 KST일)
    const t1 = Date.UTC(2026, 5, 25, 14, 0, 0);
    const first = rl.consume('puuidA', t1, limit);
    const blocked = rl.consume('puuidA', t1, limit);
    // +1일 → KST 날짜 바뀜
    const next = rl.consume('puuidA', t1 + DAY, limit);

    expect(first.ok).toBe(true);
    expect(blocked.ok).toBe(false);
    expect(next.ok).toBe(true);
  });

  test('KST 경계: UTC 15:00은 다음날 KST 00:00이라 날짜 키가 바뀐다', () => {
    // UTC 2026-06-25 14:59 → KST 23:59 (25일)
    const before = Date.UTC(2026, 5, 25, 14, 59, 0);
    // UTC 2026-06-25 15:00 → KST 00:00 (26일)
    const after = Date.UTC(2026, 5, 25, 15, 0, 0);
    expect(rl.kstDay(before)).toBe('2026-06-25');
    expect(rl.kstDay(after)).toBe('2026-06-26');
  });

  test('limit<=0이면 무제한(항상 통과)', () => {
    const now = Date.UTC(2026, 5, 25, 3, 0, 0);
    for (let i = 0; i < 100; i += 1) {
      expect(rl.consume('puuidA', now, 0).ok).toBe(true);
    }
  });
});
