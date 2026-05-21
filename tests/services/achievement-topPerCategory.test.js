const { extractTopAchievementsPerCategory } = require('../../src/services/achievement/topPerCategory');

describe('extractTopAchievementsPerCategory', () => {
  test('한 카테고리에 여러 티어 보유 시 최고 티어만 반환', () => {
    const rows = [
      { achievementId: 'GAMES_BRONZE', unlockedAt: '2026-01-01' },
      { achievementId: 'GAMES_SILVER', unlockedAt: '2026-02-01' },
      { achievementId: 'GAMES_GOLD', unlockedAt: '2026-03-01' },
    ];
    const result = extractTopAchievementsPerCategory(rows);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'GAMES_GOLD',
      tier: 'GOLD',
      category: 'games',
      unlockedAt: '2026-03-01',
    });
    expect(result[0].name).toBeDefined();
    expect(result[0].emoji).toBeDefined();
  });

  test('여러 카테고리는 각각 최고만 반환', () => {
    const rows = [
      { achievementId: 'GAMES_GOLD', unlockedAt: '2026-03-01' },
      { achievementId: 'WIN_STREAK_BRONZE', unlockedAt: '2026-01-01' },
      { achievementId: 'WIN_STREAK_GOLD', unlockedAt: '2026-02-01' },
      { achievementId: 'TIER_DIAMOND', unlockedAt: '2026-04-01' },
    ];
    const result = extractTopAchievementsPerCategory(rows);
    const byId = Object.fromEntries(result.map((a) => [a.category, a.id]));
    expect(byId).toEqual({
      games: 'GAMES_GOLD',
      win_streak: 'WIN_STREAK_GOLD',
      tier: 'TIER_DIAMOND',
    });
  });

  test('정의되지 않은 ID는 무시', () => {
    const rows = [
      { achievementId: 'UNKNOWN_ACHIEVEMENT_XYZ', unlockedAt: '2026-01-01' },
      { achievementId: 'GAMES_BRONZE', unlockedAt: '2026-01-01' },
    ];
    const result = extractTopAchievementsPerCategory(rows);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('GAMES_BRONZE');
  });

  test('빈 배열/null/undefined 안전 처리', () => {
    expect(extractTopAchievementsPerCategory([])).toEqual([]);
    expect(extractTopAchievementsPerCategory(null)).toEqual([]);
    expect(extractTopAchievementsPerCategory(undefined)).toEqual([]);
  });

  test('입력 순서와 무관하게 동일 결과 (티어 기준 정렬)', () => {
    const rowsA = [
      { achievementId: 'GAMES_GOLD', unlockedAt: '2026-03-01' },
      { achievementId: 'GAMES_BRONZE', unlockedAt: '2026-01-01' },
    ];
    const rowsB = [
      { achievementId: 'GAMES_BRONZE', unlockedAt: '2026-01-01' },
      { achievementId: 'GAMES_GOLD', unlockedAt: '2026-03-01' },
    ];
    expect(extractTopAchievementsPerCategory(rowsA)[0].id).toBe('GAMES_GOLD');
    expect(extractTopAchievementsPerCategory(rowsB)[0].id).toBe('GAMES_GOLD');
  });
});
