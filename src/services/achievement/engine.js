const models = require('../../db/models');
const { Op } = require('sequelize');
const { definitions, TIERS, STAT_TYPES } = require('./definitions');
const { getTierName } = require('../../utils/tierUtils');
const { logger } = require('../../loaders/logger');

/**
 * 보이스 체류 시간 배치 조회 (puuid → 총 초)
 */
async function getVoiceDurations(users, groupId) {
  const group = await models.group.findByPk(groupId);
  if (!group || !group.discordGuildId) return {};

  const discordIds = users.map((u) => u.discordId).filter(Boolean);
  if (discordIds.length === 0) return {};

  const voiceData = await models.voice_activity_daily.findAll({
    where: { guildId: group.discordGuildId, discordId: discordIds },
    attributes: ['discordId', [models.sequelize.fn('SUM', models.sequelize.col('duration')), 'totalDuration']],
    group: ['discordId'],
    raw: true,
  });

  const discordDurationMap = {};
  voiceData.forEach((v) => {
    discordDurationMap[v.discordId] = Number(v.totalDuration);
  });

  const result = {};
  users.forEach((u) => {
    if (u.discordId && discordDurationMap[u.discordId]) {
      result[u.puuid] = discordDurationMap[u.discordId];
    }
  });
  return result;
}

/**
 * 챌린지 메달 수 배치 조회 (puuid → { gold, silver, bronze })
 */
async function getMedalCounts(puuids, groupId) {
  const completedChallenges = await models.challenge.findAll({
    where: { groupId, leaderboardSnapshot: { [Op.ne]: null }, canceledAt: null },
    attributes: ['leaderboardSnapshot'],
    raw: true,
  });

  const result = {};
  const puuidSet = new Set(puuids);

  for (const ch of completedChallenges) {
    const snapshot =
      typeof ch.leaderboardSnapshot === 'string' ? JSON.parse(ch.leaderboardSnapshot) : ch.leaderboardSnapshot;
    if (!Array.isArray(snapshot)) continue;

    for (const entry of snapshot) {
      if (!puuidSet.has(entry.puuid)) continue;
      if (!result[entry.puuid]) result[entry.puuid] = { gold: 0, silver: 0, bronze: 0 };
      if (entry.rank === 1) result[entry.puuid].gold++;
      else if (entry.rank === 2) result[entry.puuid].silver++;
      else if (entry.rank === 3) result[entry.puuid].bronze++;
    }
  }

  return result;
}

/**
 * 업적 체크 로직
 */
function checkAchievement(def, user, extra) {
  const { category, goal } = def;
  if (category === 'match') {
    return user.win >= goal;
  }
  if (category === 'games') {
    return user.win + user.lose >= goal;
  }
  if (category === 'streak') {
    if (def.id.startsWith('WIN_STREAK')) return (extra.bestWinStreak || 0) >= goal;
    if (def.id.startsWith('LOSE_STREAK')) return (extra.bestLoseStreak || 0) >= goal;
  }
  if (category === 'tier') {
    const rating = user.defaultRating + user.additionalRating;
    const userTier = getTierName(rating);
    return TIERS.indexOf(userTier) >= TIERS.indexOf(goal);
  }
  if (category === 'voice') {
    const durationSeconds = extra.voiceDuration || 0;
    return durationSeconds >= goal * 3600;
  }
  if (category === 'underdog') {
    return (extra.underdogWins || 0) >= goal;
  }
  if (category === 'late_night') {
    return (extra.lateNightGames || 0) >= goal;
  }
  if (category === 'challenge') {
    const medals = extra.medalCounts || { gold: 0, silver: 0, bronze: 0 };
    if (def.id === 'CHALLENGE_TRIPLE_GOLD') return medals.gold >= goal;
    if (def.id === 'CHALLENGE_GOLD_MEDAL') return medals.gold >= goal;
    if (def.id === 'CHALLENGE_SILVER_MEDAL') return medals.silver >= goal;
    if (def.id === 'CHALLENGE_BRONZE_MEDAL') return medals.bronze >= goal;
  }
  return false;
}

/**
 * 업적 체크 및 해금
 */
async function processAchievements(trigger, context) {
  try {
    const defs = definitions.filter((d) => d.trigger === trigger);
    if (defs.length === 0) return [];

    const { groupId, userMap } = context;
    const users = Object.values(userMap).filter(Boolean);
    if (users.length === 0) return [];

    const puuids = users.map((u) => u.puuid);
    const achievementIds = defs.map((d) => d.id);

    // 기존 달성 기록 배치 조회
    const existing = await models.user_achievement.findAll({
      where: { groupId, puuid: puuids, achievementId: achievementIds },
      attributes: ['puuid', 'achievementId'],
    });
    const existingSet = new Set(existing.map((e) => `${e.puuid}:${e.achievementId}`));

    // 카테고리별 데이터 병렬 조회
    const needsVoice = defs.some((d) => d.category === 'voice');
    const needsChallenge = defs.some((d) => d.category === 'challenge');
    const needsStats = defs.some(
      (d) => d.category === 'streak' || d.category === 'underdog' || d.category === 'late_night',
    );

    const [voiceDurationMap, medalCountsMap, statsRows] = await Promise.all([
      needsVoice ? getVoiceDurations(users, groupId) : {},
      needsChallenge ? getMedalCounts(puuids, groupId) : {},
      needsStats
        ? models.user_achievement_stats.findAll({
            where: {
              groupId,
              puuid: puuids,
              statType: [
                STAT_TYPES.UNDERDOG_WINS,
                STAT_TYPES.LATE_NIGHT_GAMES,
                STAT_TYPES.BEST_WIN_STREAK,
                STAT_TYPES.BEST_LOSE_STREAK,
              ],
            },
            raw: true,
          })
        : [],
    ]);

    const statsMap = {};
    statsRows.forEach((s) => {
      if (!statsMap[s.puuid]) statsMap[s.puuid] = {};
      statsMap[s.puuid][s.statType] = s.value;
    });

    const newUnlocks = [];

    for (const user of users) {
      // 이 유저의 미달성 업적 필터
      const unchecked = defs.filter((d) => !existingSet.has(`${user.puuid}:${d.id}`));
      if (unchecked.length === 0) continue;

      const userStats = statsMap[user.puuid] || {};
      const extra = {
        voiceDuration: voiceDurationMap[user.puuid] || 0,
        medalCounts: medalCountsMap[user.puuid] || { gold: 0, silver: 0, bronze: 0 },
        underdogWins: userStats[STAT_TYPES.UNDERDOG_WINS] || 0,
        lateNightGames: userStats[STAT_TYPES.LATE_NIGHT_GAMES] || 0,
        bestWinStreak: userStats[STAT_TYPES.BEST_WIN_STREAK] || 0,
        bestLoseStreak: userStats[STAT_TYPES.BEST_LOSE_STREAK] || 0,
      };

      for (const def of unchecked) {
        if (checkAchievement(def, user, extra)) {
          newUnlocks.push({
            groupId,
            puuid: user.puuid,
            achievementId: def.id,
            unlockedAt: new Date(),
          });
        }
      }
    }

    if (newUnlocks.length > 0) {
      await models.user_achievement.bulkCreate(newUnlocks, { ignoreDuplicates: true });
    }

    return newUnlocks;
  } catch (e) {
    logger.error('업적 처리 오류:', e);
    return [];
  }
}

module.exports = { processAchievements };
