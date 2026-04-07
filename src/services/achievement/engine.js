const models = require('../../db/models');
const { Op } = require('sequelize');
const { definitions } = require('./definitions');
const { getTierName } = require('../../utils/tierUtils');
const { logger } = require('../../loaders/logger');

/**
 * 유저의 최근 연승/연패 수를 계산
 */
async function getStreaks(puuid, groupId, limit) {
  const matches = await models.match.findAll({
    where: {
      groupId,
      winTeam: { [Op.ne]: null },
      [Op.or]: [
        { team1: { [Op.like]: `%${puuid}%` } },
        { team2: { [Op.like]: `%${puuid}%` } },
      ],
    },
    order: [['createdAt', 'DESC']],
    limit,
  });

  let winStreak = 0;
  let loseStreak = 0;

  for (const match of matches) {
    const inTeam1 = match.team1.some((p) => p[0] === puuid);
    const won = (inTeam1 && match.winTeam === 1) || (!inTeam1 && match.winTeam === 2);

    if (winStreak === 0 && loseStreak === 0) {
      if (won) winStreak = 1;
      else loseStreak = 1;
    } else if (winStreak > 0 && won) {
      winStreak++;
    } else if (loseStreak > 0 && !won) {
      loseStreak++;
    } else {
      break;
    }
  }

  return { winStreak, loseStreak };
}

/**
 * 업적 체크 로직
 */
function checkAchievement(def, user, streaks) {
  const { category, goal } = def;
  if (category === 'match') {
    return user.win >= goal;
  }
  if (category === 'games') {
    return (user.win + user.lose) >= goal;
  }
  if (category === 'streak') {
    if (def.id.startsWith('WIN_STREAK')) return streaks.winStreak >= goal;
    if (def.id.startsWith('LOSE_STREAK')) return streaks.loseStreak >= goal;
  }
  if (category === 'tier') {
    const rating = user.defaultRating + user.additionalRating;
    return getTierName(rating) === 'CHALLENGER';
  }
  return false;
}

/**
 * 매치 결과 후 업적 체크 및 해금
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

    // 연승/연패 체크가 필요한 업적이 있는지 확인
    const needsStreaks = defs.some((d) => d.category === 'streak');
    const maxStreakGoal = needsStreaks
      ? Math.max(...defs.filter((d) => d.category === 'streak').map((d) => d.goal))
      : 0;

    const newUnlocks = [];

    for (const user of users) {
      // 이 유저의 미달성 업적 필터
      const unchecked = defs.filter((d) => !existingSet.has(`${user.puuid}:${d.id}`));
      if (unchecked.length === 0) continue;

      // 연승/연패 데이터 조회 (필요한 경우만, 유저당 1회)
      let streaks = { winStreak: 0, loseStreak: 0 };
      if (unchecked.some((d) => d.category === 'streak')) {
        streaks = await getStreaks(user.puuid, groupId, maxStreakGoal);
      }

      for (const def of unchecked) {
        if (checkAchievement(def, user, streaks)) {
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
