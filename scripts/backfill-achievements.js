/**
 * 기존 유저 업적 일괄 부여 스크립트
 * 실행: node scripts/backfill-achievements.js
 */
require('dotenv').config();
const models = require('../src/db/models');
const { processAchievements } = require('../src/services/achievement/engine');

(async () => {
  try {
    const groups = await models.group.findAll({ attributes: ['id', 'groupName'] });

    for (const group of groups) {
      const users = await models.user.findAll({
        where: { groupId: group.id },
      });

      if (users.length === 0) continue;

      const userMap = {};
      users.forEach((u) => { userMap[u.puuid] = u; });

      console.log(`[${group.groupName}] ${users.length}명 업적 체크 중...`);

      const newAchievements = await processAchievements('match_result', {
        groupId: group.id,
        matchData: null,
        userMap,
      });

      console.log(`[${group.groupName}] ${newAchievements.length}개 업적 부여 완료`);
    }

    console.log('완료');
    process.exit(0);
  } catch (e) {
    console.error('오류:', e);
    process.exit(1);
  }
})();
