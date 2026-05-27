jest.mock('../../src/db/models', () => ({
  match: { findAll: jest.fn() },
  user: { findAll: jest.fn() },
}));

const { computeScout } = require('../../src/services/auction-scout');

const mkMatch = (t1, t2, winTeam) => ({
  team1: JSON.stringify(t1.map((p) => [p])),
  team2: JSON.stringify(t2.map((p) => [p])),
  winTeam,
});

describe('computeScout', () => {
  const matches = [
    mkMatch(['A', 'B'], ['C', 'D'], 1), // A,B 승 / C,D 패
    mkMatch(['A', 'B'], ['C', 'D'], 2), // A,B 패 / C,D 승
    mkMatch(['A', 'C'], ['B', 'D'], 1), // A,C 승 / B,D 패
  ];

  test('천생연분: 합방 MIN_GAMES 이상만, 승률순', () => {
    const map = computeScout(matches);
    // A-B는 2판(1승1패) → 포함, A-C는 1판 → 최소 합방수 미달로 제외
    expect(map.A.soulmates.map((s) => s.puuid)).toEqual(['B']);
    expect(map.A.soulmates[0]).toMatchObject({ games: 2, wins: 1, winRate: 50 });
  });

  test('톰과제리: 가장 자주 만난 상대 순', () => {
    const map = computeScout(matches);
    // A의 상대: D는 3판(m1,m2,m3), C는 2판(m1,m2), B는 1판(m3)
    expect(map.A.nemeses.map((n) => n.puuid)).toEqual(['D', 'C', 'B']);
    expect(map.A.nemeses[0]).toMatchObject({ puuid: 'D', games: 3 });
  });

  test('outsider는 본인/상대 양쪽에서 제외', () => {
    const map = computeScout(matches, new Set(['C']));
    expect(map.C).toBeUndefined(); // 본인이 outsider면 맵에 없음
    expect(map.A.nemeses.map((n) => n.puuid)).not.toContain('C'); // 상대 목록에서도 제외
  });
});
