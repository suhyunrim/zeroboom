const { definitions, TIERS } = require('./definitions');

const defById = new Map(definitions.map((d) => [d.id, d]));
const tierRank = new Map(TIERS.map((t, i) => [t, i]));

/**
 * 보유한 업적 row 배열을 받아 카테고리별로 가장 높은 티어 1개만 추린다.
 * 정의되지 않은(legacy) achievementId는 무시.
 *
 * @param {Array<{ achievementId: string, unlockedAt: Date | string }>} unlockedRows
 * @returns {Array<{ id, name, description, emoji, tier, category, unlockedAt }>}
 */
const extractTopAchievementsPerCategory = (unlockedRows) => {
  const byCategory = new Map();
  for (const row of unlockedRows || []) {
    const def = defById.get(row.achievementId);
    if (!def) continue;
    const curRank = (tierRank.get(def.tier) ?? -1);
    const prev = byCategory.get(def.category);
    const prevRank = prev ? (tierRank.get(prev.tier) ?? -1) : -1;
    if (!prev || curRank > prevRank) {
      byCategory.set(def.category, {
        id: def.id,
        name: def.name,
        description: def.description,
        emoji: def.emoji,
        tier: def.tier,
        category: def.category,
        unlockedAt: row.unlockedAt,
      });
    }
  }
  return [...byCategory.values()];
};

module.exports = { extractTopAchievementsPerCategory };
