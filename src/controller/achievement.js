const { Op } = require('sequelize');
const models = require('../db/models');
const { definitions, STAT_TYPES } = require('../services/achievement/definitions');

const RECENT_UNLOCKERS_LIMIT = 3;
const TOP_USERS_LIMIT = 10;
const TOP_PROGRESS_LIMIT = 10;
const UNKNOWN_NAME = '알 수 없음';

const CATEGORY_TO_STAT = {
  underdog: STAT_TYPES.UNDERDOG_WINS,
  late_night: STAT_TYPES.LATE_NIGHT_GAMES,
  weekend_games: STAT_TYPES.WEEKEND_GAMES,
  weekday_games: STAT_TYPES.WEEKDAY_GAMES,
  games_per_day: STAT_TYPES.MAX_GAMES_PER_DAY,
  welcomer: STAT_TYPES.WELCOMER_WINS,
  consecutive_days: STAT_TYPES.BEST_CONSECUTIVE_DAYS,
  match_mvp: STAT_TYPES.MATCH_MVP_COUNT,
  match_mvp_streak: STAT_TYPES.BEST_MATCH_MVP_STREAK,
  reverse_win: STAT_TYPES.REVERSE_WINS,
  reverse_lose: STAT_TYPES.REVERSE_LOSES,
  sweep_win: STAT_TYPES.SWEEP_WINS,
  sweep_lose: STAT_TYPES.SWEEP_LOSES,
  night_owl: STAT_TYPES.NIGHT_OWL_SESSIONS,
  channel_creator: STAT_TYPES.TEMP_VOICE_CREATED,
};

async function getActiveMembers(groupId) {
  return models.user.findAll({
    where: { groupId, primaryPuuid: null, role: { [Op.ne]: 'outsider' } },
    attributes: ['puuid', 'discordId'],
    raw: true,
  });
}

async function getSummonerNameMap(puuids) {
  if (!puuids.length) return {};
  const summoners = await models.summoner.findAll({
    where: { puuid: puuids },
    attributes: ['puuid', 'name'],
    raw: true,
  });
  return summoners.reduce((acc, s) => {
    acc[s.puuid] = s.name;
    return acc;
  }, {});
}

function resolveStatType(def) {
  if (def.category === 'streak') {
    return def.id.startsWith('WIN_STREAK') ? STAT_TYPES.BEST_WIN_STREAK : STAT_TYPES.BEST_LOSE_STREAK;
  }
  return CATEGORY_TO_STAT[def.category] || null;
}

function pct(n, total) {
  return total ? Math.round((n / total) * 1000) / 10 : 0;
}

function mkUnlockerInfo(record, nameMap, extra = null) {
  if (!record) return null;
  const info = {
    puuid: record.puuid,
    name: nameMap[record.puuid] || UNKNOWN_NAME,
    unlockedAt: record.unlockedAt,
  };
  return extra ? { ...extra, ...info } : info;
}

async function getDashboard(groupId) {
  const activeMembers = await getActiveMembers(groupId);
  const activePuuids = activeMembers.map((u) => u.puuid);
  const totalActiveUsers = activeMembers.length;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const { fn, col, literal } = models.sequelize;

  const [perAchievement, perUser, totalUnlocksRow, newUnlocksRow] = activePuuids.length
    ? await Promise.all([
      models.user_achievement.findAll({
        where: { groupId, puuid: activePuuids },
        attributes: ['achievementId', [fn('COUNT', col('id')), 'cnt']],
        group: ['achievementId'],
        raw: true,
      }),
      models.user_achievement.findAll({
        where: { groupId, puuid: activePuuids },
        attributes: ['puuid', [fn('COUNT', col('id')), 'cnt']],
        group: ['puuid'],
        order: [[literal('cnt'), 'DESC']],
        limit: TOP_USERS_LIMIT,
        raw: true,
      }),
      models.user_achievement.count({ where: { groupId, puuid: activePuuids } }),
      models.user_achievement.count({
        where: { groupId, puuid: activePuuids, unlockedAt: { [Op.gte]: weekAgo } },
      }),
    ])
    : [[], [], 0, 0];

  const countByAchievement = {};
  perAchievement.forEach((r) => { countByAchievement[r.achievementId] = Number(r.cnt); });

  const nameMap = await getSummonerNameMap(perUser.map((r) => r.puuid));
  const topUsers = perUser.map((r) => ({
    puuid: r.puuid,
    name: nameMap[r.puuid] || UNKNOWN_NAME,
    unlockCount: Number(r.cnt),
  }));

  const categoryMap = {};
  definitions.forEach((def) => {
    if (!categoryMap[def.category]) {
      categoryMap[def.category] = { totalAchievements: 0, unlockedAchievements: 0, totalUnlocks: 0 };
    }
    categoryMap[def.category].totalAchievements++;
    const cnt = countByAchievement[def.id] || 0;
    if (cnt > 0) categoryMap[def.category].unlockedAchievements++;
    categoryMap[def.category].totalUnlocks += cnt;
  });

  const categoryStats = Object.entries(categoryMap)
    .map(([category, stats]) => ({
      category,
      totalAchievements: stats.totalAchievements,
      unlockedAchievements: stats.unlockedAchievements,
      unlockRate: pct(stats.unlockedAchievements, stats.totalAchievements),
      totalUnlocks: stats.totalUnlocks,
      avgUnlockRate: pct(stats.totalUnlocks, stats.totalAchievements * totalActiveUsers),
    }))
    .sort((a, b) => b.unlockRate - a.unlockRate);

  const unlockedAchievementCount = categoryStats.reduce((s, c) => s + c.unlockedAchievements, 0);
  const summary = {
    totalAchievements: definitions.length,
    unlockedAchievements: unlockedAchievementCount,
    unlockRate: pct(unlockedAchievementCount, definitions.length),
    totalUnlocks: totalUnlocksRow,
    newUnlocksThisWeek: newUnlocksRow,
    totalActiveUsers,
  };

  return { summary, topUsers, categoryStats };
}

async function getCategoryAchievements(groupId, category) {
  const defsInCategory = definitions.filter((d) => d.category === category);
  if (defsInCategory.length === 0) return null;

  const activeMembers = await getActiveMembers(groupId);
  const activePuuids = activeMembers.map((u) => u.puuid);
  const totalActiveUsers = activeMembers.length;
  const achievementIds = defsInCategory.map((d) => d.id);

  const unlocks = activePuuids.length
    ? await models.user_achievement.findAll({
      where: { groupId, puuid: activePuuids, achievementId: achievementIds },
      attributes: ['puuid', 'achievementId', 'unlockedAt'],
      order: [['unlockedAt', 'ASC']],
      raw: true,
    })
    : [];

  const nameMap = await getSummonerNameMap([...new Set(unlocks.map((u) => u.puuid))]);

  const byAchievement = {};
  unlocks.forEach((u) => {
    if (!byAchievement[u.achievementId]) byAchievement[u.achievementId] = [];
    byAchievement[u.achievementId].push(u);
  });

  const achievements = defsInCategory.map((def) => {
    const records = byAchievement[def.id] || [];
    const unlockedCount = records.length;
    const recentUnlockers = records
      .slice(-RECENT_UNLOCKERS_LIMIT)
      .reverse()
      .map((r) => mkUnlockerInfo(r, nameMap));

    return {
      id: def.id,
      name: def.name,
      description: def.description,
      emoji: def.emoji,
      tier: def.tier,
      category: def.category,
      goal: def.goal || null,
      unlockedCount,
      unlockRate: pct(unlockedCount, totalActiveUsers),
      recentUnlockers,
      firstUnlocker: mkUnlockerInfo(records[0], nameMap),
      latestUnlocker: mkUnlockerInfo(records[records.length - 1], nameMap),
    };
  });

  return { category, totalActiveUsers, achievements };
}

async function getAchievementRanking(groupId, achievementId) {
  const def = definitions.find((d) => d.id === achievementId);
  if (!def) return null;

  const activeMembers = await getActiveMembers(groupId);
  const activePuuids = activeMembers.map((u) => u.puuid);
  const totalActiveUsers = activeMembers.length;

  const unlocks = activePuuids.length
    ? await models.user_achievement.findAll({
      where: { groupId, achievementId, puuid: activePuuids },
      attributes: ['puuid', 'unlockedAt'],
      order: [['unlockedAt', 'ASC']],
      raw: true,
    })
    : [];

  const unlockedPuuidSet = new Set(unlocks.map((u) => u.puuid));
  const unlockedCount = unlocks.length;

  let progressRows = [];
  const statType = resolveStatType(def);
  if (statType && def.goal) {
    const pendingPuuids = activePuuids.filter((p) => !unlockedPuuidSet.has(p));
    if (pendingPuuids.length) {
      progressRows = await models.user_achievement_stats.findAll({
        where: { groupId, puuid: pendingPuuids, statType },
        attributes: ['puuid', 'value'],
        raw: true,
      });
    }
  }

  const referencedPuuids = new Set([...unlockedPuuidSet, ...progressRows.map((r) => r.puuid)]);
  const nameMap = await getSummonerNameMap([...referencedPuuids]);

  const unlockers = unlocks.map((u, idx) => mkUnlockerInfo(u, nameMap, { rank: idx + 1 }));

  const topProgress = progressRows
    .filter((s) => Number(s.value) > 0)
    .map((s) => ({
      puuid: s.puuid,
      name: nameMap[s.puuid] || UNKNOWN_NAME,
      currentValue: Number(s.value),
      goal: def.goal,
      progressRate: pct(Number(s.value), def.goal),
    }))
    .sort((a, b) => b.currentValue - a.currentValue)
    .slice(0, TOP_PROGRESS_LIMIT);

  return {
    achievement: {
      id: def.id,
      name: def.name,
      description: def.description,
      emoji: def.emoji,
      tier: def.tier,
      category: def.category,
      goal: def.goal || null,
      unlockedCount,
      unlockRate: pct(unlockedCount, totalActiveUsers),
      firstUnlocker: mkUnlockerInfo(unlocks[0], nameMap),
      latestUnlocker: mkUnlockerInfo(unlocks[unlocks.length - 1], nameMap),
    },
    unlockers,
    topProgress,
    hasProgress: !!statType,
  };
}

module.exports = {
  getDashboard,
  getCategoryAchievements,
  getAchievementRanking,
  getActiveMembers,
  resolveStatType,
};
