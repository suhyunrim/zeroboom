/**
 * best_win_streak / best_lose_streak stat 백필.
 *
 * 기존 match.js의 streak 계산은 그룹 매치 30개를 잘라본 뒤 본인 참여분만 추리는 방식이라,
 * 자주 참여하지 않는 유저는 streak 끊는 매치가 윈도 밖으로 밀려나 stat이 저평가됨.
 *
 * 본 스크립트는 각 유저의 전체 매치 히스토리에서 최대 win/lose streak을 재계산하고
 * 기존 stat보다 크면 GREATEST 의미로 갱신, 새로 자격된 streak 업적을 일괄 해금한다.
 *
 * 사용: node scripts/backfill-win-lose-streak.js [--dry-run] [--group=4]
 */

const { Op } = require('sequelize');
const models = require('../src/db/models');
const { STAT_TYPES } = require('../src/services/achievement/definitions');
const statsRepo = require('../src/services/achievement/stats');
const { processAchievements } = require('../src/services/achievement/engine');

const DRY_RUN = process.argv.includes('--dry-run');
const GROUP_ARG = process.argv.find((a) => a.startsWith('--group='));
const ONLY_GROUP = GROUP_ARG ? Number(GROUP_ARG.split('=')[1]) : null;

async function computeStreaksForUser(groupId, puuid) {
  const [rows] = await models.sequelize.query(
    `SELECT winTeam, team1, team2 FROM matches
     WHERE groupId = :groupId AND winTeam IS NOT NULL
       AND (JSON_CONTAINS(JSON_EXTRACT(team1, '$[*][0]'), JSON_QUOTE(:puuid)) = 1
            OR JSON_CONTAINS(JSON_EXTRACT(team2, '$[*][0]'), JSON_QUOTE(:puuid)) = 1)
     ORDER BY createdAt ASC, gameId ASC`,
    { replacements: { groupId, puuid } },
  );
  let curW = 0; let curL = 0; let bestW = 0; let bestL = 0;
  for (const m of rows) {
    const t1 = typeof m.team1 === 'string' ? JSON.parse(m.team1) : m.team1;
    const inT1 = t1.some((p) => p[0] === puuid);
    const won = (inT1 && m.winTeam === 1) || (!inT1 && m.winTeam === 2);
    if (won) {
      curW += 1; curL = 0;
      if (curW > bestW) bestW = curW;
    } else {
      curL += 1; curW = 0;
      if (curL > bestL) bestL = curL;
    }
  }
  return { bestW, bestL, matchCount: rows.length };
}

async function main() {
  const groupsWhere = ONLY_GROUP ? { id: ONLY_GROUP } : {};
  const groups = await models.group.findAll({ where: groupsWhere, raw: true });
  console.log(`DRY_RUN=${DRY_RUN} groups=${groups.map((g) => g.id).join(',')}\n`);

  let totalUpdated = 0;
  let totalNewUnlocks = 0;

  for (const g of groups) {
    console.log(`=== Group ${g.id} (${g.groupName}) ===`);
    const users = await models.user.findAll({
      where: { groupId: g.id, primaryPuuid: null, role: { [Op.ne]: 'outsider' } },
    });
    console.log(`  active users: ${users.length}`);

    const affectedUserMap = {};
    let groupUpdated = 0;

    for (const user of users) {
      const { bestW, bestL, matchCount } = await computeStreaksForUser(g.id, user.puuid);
      if (matchCount === 0) continue;

      const existing = await models.user_achievement_stats.findAll({
        where: {
          puuid: user.puuid,
          groupId: g.id,
          statType: [STAT_TYPES.BEST_WIN_STREAK, STAT_TYPES.BEST_LOSE_STREAK],
        },
        raw: true,
      });
      const exW = Number(existing.find((s) => s.statType === STAT_TYPES.BEST_WIN_STREAK)?.value ?? 0);
      const exL = Number(existing.find((s) => s.statType === STAT_TYPES.BEST_LOSE_STREAK)?.value ?? 0);

      const wDelta = bestW > exW;
      const lDelta = bestL > exL;
      if (!wDelta && !lDelta) continue;

      console.log(
        `  ${user.puuid.slice(0, 12)}... matches=${matchCount} `
        + `win: ${exW}→${bestW}${wDelta ? ' ✓' : ''}, lose: ${exL}→${bestL}${lDelta ? ' ✓' : ''}`,
      );

      if (!DRY_RUN) {
        if (wDelta) await statsRepo.updateBestStat(user.puuid, g.id, STAT_TYPES.BEST_WIN_STREAK, bestW);
        if (lDelta) await statsRepo.updateBestStat(user.puuid, g.id, STAT_TYPES.BEST_LOSE_STREAK, bestL);
      }
      affectedUserMap[user.puuid] = user;
      groupUpdated++;
    }

    console.log(`  affected: ${groupUpdated} users`);
    totalUpdated += groupUpdated;

    if (!DRY_RUN && Object.keys(affectedUserMap).length > 0) {
      const unlocks = await processAchievements('match_result', {
        groupId: g.id,
        userMap: affectedUserMap,
      });
      console.log(`  new unlocks: ${unlocks.length}`);
      totalNewUnlocks += unlocks.length;
    }
    console.log('');
  }

  console.log(`\n총 ${totalUpdated} 유저 stat 갱신${DRY_RUN ? ' (dry-run)' : ''}, ${totalNewUnlocks} 업적 해금`);
  await models.sequelize.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
