const { Op } = require('sequelize');
const models = require('../../db/models');
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
 * 명예 투표 받음/참여 카운트 배치 조회
 */
async function getHonorCounts(puuids, groupId) {
  const { fn, col } = models.sequelize;
  const [received, voted] = await Promise.all([
    models.honor_vote.findAll({
      where: { groupId, targetPuuid: puuids },
      attributes: ['targetPuuid', [fn('COUNT', col('id')), 'cnt']],
      group: ['targetPuuid'],
      raw: true,
    }),
    models.honor_vote.findAll({
      where: { groupId, voterPuuid: puuids },
      attributes: ['voterPuuid', [fn('COUNT', col('id')), 'cnt']],
      group: ['voterPuuid'],
      raw: true,
    }),
  ]);
  const receivedMap = {};
  received.forEach((r) => {
    receivedMap[r.targetPuuid] = Number(r.cnt);
  });
  const votedMap = {};
  voted.forEach((v) => {
    votedMap[v.voterPuuid] = Number(v.cnt);
  });
  return { receivedMap, votedMap };
}

// 단순 `extra[key] >= goal` 로 판정되는 카테고리들. 카테고리 → extra 키 매핑.
const SIMPLE_STAT_CATEGORIES = {
  underdog: 'underdogWins',
  late_night: 'lateNightGames',
  win_streak: 'bestWinStreak',
  lose_streak: 'bestLoseStreak',
  weekend_games: 'weekendGames',
  weekday_games: 'weekdayGames',
  games_per_day: 'maxGamesPerDay',
  welcomer: 'welcomerWins',
  consecutive_days: 'bestConsecutiveDays',
  honor_received: 'honorReceived',
  honor_voted_count: 'honorVotedCount',
  match_mvp: 'matchMvpCount',
  match_mvp_streak: 'bestMatchMvpStreak',
  reverse_win: 'reverseWins',
  reverse_lose: 'reverseLoses',
  sweep_win: 'sweepWins',
  sweep_lose: 'sweepLoses',
  night_owl: 'nightOwlSessions',
  channel_creator: 'tempVoiceCreated',
  prediction_perfect: 'predictionPerfectCount',
};

const CHALLENGE_MEDAL_KEY = {
  CHALLENGE_TRIPLE_GOLD: 'gold',
  CHALLENGE_GOLD_MEDAL: 'gold',
  CHALLENGE_SILVER_MEDAL: 'silver',
  CHALLENGE_BRONZE_MEDAL: 'bronze',
};

/**
 * 업적 체크 로직
 */
function checkAchievement(def, user, extra) {
  const { category, goal } = def;

  const simpleKey = SIMPLE_STAT_CATEGORIES[category];
  if (simpleKey) return (extra[simpleKey] || 0) >= goal;

  if (category === 'match') return user.win >= goal;
  if (category === 'games') return user.win + user.lose + (extra.externalGames || 0) >= goal;
  if (category === 'tier') {
    const bestRating = extra.bestRating || user.defaultRating + user.additionalRating;
    return TIERS.indexOf(getTierName(bestRating)) >= TIERS.indexOf(goal);
  }
  if (category === 'voice') return (extra.voiceDuration || 0) >= goal * 3600;
  if (category === 'challenge') {
    const medalKey = CHALLENGE_MEDAL_KEY[def.id];
    const medals = extra.medalCounts || { gold: 0, silver: 0, bronze: 0 };
    return medalKey ? medals[medalKey] >= goal : false;
  }
  if (category === 'anniversary') {
    if (!user.createdAt) return false;
    const elapsedDays = Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (24 * 60 * 60 * 1000));
    return elapsedDays >= goal;
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
    const needsGames = defs.some((d) => d.category === 'games');
    const needsVoice = defs.some((d) => d.category === 'voice');
    const needsChallenge = defs.some((d) => d.category === 'challenge');
    const needsStats = defs.some(
      (d) =>
        d.category === 'win_streak' ||
        d.category === 'lose_streak' ||
        d.category === 'underdog' ||
        d.category === 'late_night' ||
        d.category === 'tier' ||
        d.category === 'weekend_games' ||
        d.category === 'weekday_games' ||
        d.category === 'games_per_day' ||
        d.category === 'welcomer' ||
        d.category === 'consecutive_days' ||
        d.category === 'match_mvp' ||
        d.category === 'match_mvp_streak' ||
        d.category === 'reverse_win' ||
        d.category === 'reverse_lose' ||
        d.category === 'sweep_win' ||
        d.category === 'sweep_lose' ||
        d.category === 'night_owl' ||
        d.category === 'channel_creator' ||
        d.category === 'prediction_perfect',
    );
    const needsHonor = defs.some((d) => d.category === 'honor_received' || d.category === 'honor_voted_count');

    const [externalRecords, voiceDurationMap, medalCountsMap, statsRows, honorCounts] = await Promise.all([
      needsGames
        ? models.externalRecord.findAll({
            where: { groupId, puuid: puuids },
            attributes: ['puuid', 'win', 'lose'],
            raw: true,
          })
        : [],
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
                STAT_TYPES.BEST_RATING,
                STAT_TYPES.WEEKEND_GAMES,
                STAT_TYPES.WEEKDAY_GAMES,
                STAT_TYPES.MAX_GAMES_PER_DAY,
                STAT_TYPES.WELCOMER_WINS,
                STAT_TYPES.BEST_CONSECUTIVE_DAYS,
                STAT_TYPES.MATCH_MVP_COUNT,
                STAT_TYPES.BEST_MATCH_MVP_STREAK,
                STAT_TYPES.REVERSE_WINS,
                STAT_TYPES.REVERSE_LOSES,
                STAT_TYPES.SWEEP_WINS,
                STAT_TYPES.SWEEP_LOSES,
                STAT_TYPES.NIGHT_OWL_SESSIONS,
                STAT_TYPES.TEMP_VOICE_CREATED,
                STAT_TYPES.PREDICTION_PERFECT_COUNT,
              ],
            },
            raw: true,
          })
        : [],
      needsHonor ? getHonorCounts(puuids, groupId) : { receivedMap: {}, votedMap: {} },
    ]);

    const externalGamesMap = {};
    externalRecords.forEach((r) => {
      externalGamesMap[r.puuid] = (externalGamesMap[r.puuid] || 0) + (r.win || 0) + (r.lose || 0);
    });

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
        externalGames: externalGamesMap[user.puuid] || 0,
        voiceDuration: voiceDurationMap[user.puuid] || 0,
        medalCounts: medalCountsMap[user.puuid] || { gold: 0, silver: 0, bronze: 0 },
        underdogWins: userStats[STAT_TYPES.UNDERDOG_WINS] || 0,
        lateNightGames: userStats[STAT_TYPES.LATE_NIGHT_GAMES] || 0,
        bestWinStreak: userStats[STAT_TYPES.BEST_WIN_STREAK] || 0,
        bestLoseStreak: userStats[STAT_TYPES.BEST_LOSE_STREAK] || 0,
        bestRating: userStats[STAT_TYPES.BEST_RATING] || 0,
        weekendGames: userStats[STAT_TYPES.WEEKEND_GAMES] || 0,
        weekdayGames: userStats[STAT_TYPES.WEEKDAY_GAMES] || 0,
        maxGamesPerDay: userStats[STAT_TYPES.MAX_GAMES_PER_DAY] || 0,
        welcomerWins: userStats[STAT_TYPES.WELCOMER_WINS] || 0,
        bestConsecutiveDays: userStats[STAT_TYPES.BEST_CONSECUTIVE_DAYS] || 0,
        matchMvpCount: userStats[STAT_TYPES.MATCH_MVP_COUNT] || 0,
        bestMatchMvpStreak: userStats[STAT_TYPES.BEST_MATCH_MVP_STREAK] || 0,
        honorReceived: honorCounts.receivedMap[user.puuid] || 0,
        honorVotedCount: honorCounts.votedMap[user.puuid] || 0,
        reverseWins: userStats[STAT_TYPES.REVERSE_WINS] || 0,
        reverseLoses: userStats[STAT_TYPES.REVERSE_LOSES] || 0,
        sweepWins: userStats[STAT_TYPES.SWEEP_WINS] || 0,
        sweepLoses: userStats[STAT_TYPES.SWEEP_LOSES] || 0,
        nightOwlSessions: userStats[STAT_TYPES.NIGHT_OWL_SESSIONS] || 0,
        tempVoiceCreated: userStats[STAT_TYPES.TEMP_VOICE_CREATED] || 0,
        predictionPerfectCount: userStats[STAT_TYPES.PREDICTION_PERFECT_COUNT] || 0,
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

      // lazy require — 순환 의존 방지
      try {
        const notificationController = require('../../controller/notification');
        const { fetchDiscordIdMap } = require('../../utils/userLookup');
        const discordByPuuid = await fetchDiscordIdMap(groupId, newUnlocks.map((u) => u.puuid));
        const defById = new Map(definitions.map((d) => [d.id, d]));
        const rows = newUnlocks
          .map((unlock) => {
            const did = discordByPuuid[unlock.puuid];
            if (!did) return null;
            const def = defById.get(unlock.achievementId);
            return {
              recipientDiscordId: did,
              groupId,
              type: notificationController.NOTIFICATION_TYPES.ACHIEVEMENT_UNLOCK,
              targetKey: null,
              payload: {
                achievementId: unlock.achievementId,
                achievementName: def ? def.name : null,
                achievementTier: def ? def.tier : null,
                achievementEmoji: def ? def.emoji : null,
              },
            };
          })
          .filter(Boolean);
        await notificationController.createMany(rows);
      } catch (e) {
        logger.error('업적 알림 발송 실패:', e);
      }
    }

    return newUnlocks;
  } catch (e) {
    logger.error('업적 처리 오류:', e);
    return [];
  }
}

module.exports = { processAchievements };
