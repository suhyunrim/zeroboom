/**
 * 기존 유저 업적 일괄 부여 스크립트
 * - 매치 히스토리에서 언더독 승리/야식 통계를 계산하여 user_achievement_stats에 저장
 * - 모든 업적을 재체크하여 미달성 업적 부여
 * 실행: node scripts/backfill-achievements.js
 */
require('dotenv').config();
const { Op } = require('sequelize');
const elo = require('arpad');
const models = require('../src/db/models');
const { processAchievements } = require('../src/services/achievement/engine');
const { getKSTHours } = require('../src/utils/timeUtils');

const ratingCalculator = new elo(16);

async function backfillStats(groupId, users) {
  const matches = await models.match.findAll({
    where: { groupId, winTeam: { [Op.ne]: null } },
    order: [['createdAt', 'ASC']],
  });

  const userMap = {};
  users.forEach((u) => {
    userMap[u.puuid] = u;
  });

  const stats = {}; // puuid → { underdog_wins, late_night_games, best_win_streak, best_lose_streak }
  const streakState = {}; // puuid → { currentWin, currentLose }

  for (const match of matches) {
    const team1Data = match.team1;
    const team2Data = match.team2;
    const hasSnapshot = team1Data[0] && team1Data[0].length >= 3;

    let team1Avg = 500;
    let team2Avg = 500;
    if (hasSnapshot) {
      const t1Ratings = team1Data.filter((p) => userMap[p[0]]).map((p) => p[2]);
      const t2Ratings = team2Data.filter((p) => userMap[p[0]]).map((p) => p[2]);
      if (t1Ratings.length > 0) team1Avg = t1Ratings.reduce((a, b) => a + b, 0) / t1Ratings.length;
      if (t2Ratings.length > 0) team2Avg = t2Ratings.reduce((a, b) => a + b, 0) / t2Ratings.length;
    }

    const team1WinRate = ratingCalculator.expectedScore(team1Avg, team2Avg);
    const isTeam1Underdog = match.winTeam === 1 && team1WinRate <= 0.45;
    const isTeam2Underdog = match.winTeam === 2 && 1 - team1WinRate <= 0.45;
    const isLateNight = getKSTHours(match.gameCreation || match.createdAt) < 5;

    const allPuuids = [...team1Data.map((p) => p[0]), ...team2Data.map((p) => p[0])];
    for (const puuid of allPuuids) {
      if (!userMap[puuid]) continue;
      if (!stats[puuid])
        stats[puuid] = { underdog_wins: 0, late_night_games: 0, best_win_streak: 0, best_lose_streak: 0 };
      if (!streakState[puuid]) streakState[puuid] = { currentWin: 0, currentLose: 0 };

      const inTeam1 = team1Data.some((p) => p[0] === puuid);
      if ((inTeam1 && isTeam1Underdog) || (!inTeam1 && isTeam2Underdog)) {
        stats[puuid].underdog_wins += 1;
      }
      if (isLateNight) {
        stats[puuid].late_night_games += 1;
      }

      const won = (inTeam1 && match.winTeam === 1) || (!inTeam1 && match.winTeam === 2);
      const ss = streakState[puuid];
      if (won) {
        ss.currentWin += 1;
        ss.currentLose = 0;
        if (ss.currentWin > stats[puuid].best_win_streak) stats[puuid].best_win_streak = ss.currentWin;
      } else {
        ss.currentLose += 1;
        ss.currentWin = 0;
        if (ss.currentLose > stats[puuid].best_lose_streak) stats[puuid].best_lose_streak = ss.currentLose;
      }
    }
  }

  // stats 테이블에 upsert
  const upserts = [];
  for (const [puuid, s] of Object.entries(stats)) {
    for (const [statType, value] of Object.entries(s)) {
      if (value === 0) continue;
      upserts.push(
        models.sequelize.query(
          `INSERT INTO user_achievement_stats (puuid, groupId, statType, value, createdAt, updatedAt)
           VALUES (:puuid, :groupId, :statType, :value, NOW(), NOW())
           ON DUPLICATE KEY UPDATE value = :value, updatedAt = NOW()`,
          { replacements: { puuid, groupId, statType, value } },
        ),
      );
    }
  }
  await Promise.all(upserts);

  return stats;
}

(async () => {
  try {
    const groups = await models.group.findAll({ attributes: ['id', 'groupName'] });

    for (const group of groups) {
      const users = await models.user.findAll({
        where: { groupId: group.id },
      });

      if (users.length === 0) continue;

      // 1. 통계 백필
      console.log(`[${group.groupName}] 매치 히스토리에서 통계 계산 중...`);
      const stats = await backfillStats(group.id, users);
      const statUsers = Object.keys(stats).length;
      console.log(`[${group.groupName}] ${statUsers}명 통계 저장 완료`);

      // 2. 업적 체크 (match_result 트리거)
      const userMap = {};
      users.forEach((u) => {
        userMap[u.puuid] = u;
      });

      console.log(`[${group.groupName}] ${users.length}명 업적 체크 중...`);
      const newAchievements = await processAchievements('match_result', {
        groupId: group.id,
        matchData: null,
        userMap,
      });
      console.log(`[${group.groupName}] ${newAchievements.length}개 업적 부여 완료`);

      // 3. 챌린지 업적 체크
      const completedChallenges = await models.challenge.findAll({
        where: { groupId: group.id, leaderboardSnapshot: { [Op.ne]: null }, canceledAt: null },
      });

      if (completedChallenges.length > 0) {
        // 상위 3명의 puuid 수집
        const medalPuuids = new Set();
        for (const ch of completedChallenges) {
          const snapshot =
            typeof ch.leaderboardSnapshot === 'string' ? JSON.parse(ch.leaderboardSnapshot) : ch.leaderboardSnapshot;
          if (!Array.isArray(snapshot)) continue;
          snapshot.filter((e) => e.rank <= 3).forEach((e) => medalPuuids.add(e.puuid));
        }

        if (medalPuuids.size > 0) {
          const medalUsers = await models.user.findAll({
            where: { groupId: group.id, puuid: [...medalPuuids] },
          });
          const medalUserMap = {};
          medalUsers.forEach((u) => {
            medalUserMap[u.puuid] = u;
          });

          const challengeAchievements = await processAchievements('challenge_end', {
            groupId: group.id,
            userMap: medalUserMap,
          });
          console.log(`[${group.groupName}] 챌린지 업적 ${challengeAchievements.length}개 부여 완료`);
        }
      }
    }

    console.log('완료');
    process.exit(0);
  } catch (e) {
    console.error('오류:', e);
    process.exit(1);
  }
})();
