const { EmbedBuilder } = require('discord.js');
const { definitions, TIERS } = require('./definitions');
const models = require('../../db/models');
const { logger } = require('../../loaders/logger');

const TIER_COLORS = {
  BRONZE: '#CD7F32',
  SILVER: '#C0C0C0',
  GOLD: '#FFD700',
  PLATINUM: '#00CED1',
  EMERALD: '#50C878',
  DIAMOND: '#B9F2FF',
  MASTER: '#9B59B6',
  GRANDMASTER: '#E74C3C',
  CHALLENGER: '#F1C40F',
};

/**
 * 같은 유저 + 같은 카테고리의 업적이 여러 개면 가장 높은 티어만 남김
 */
function filterHighestPerCategory(achievements, defMap) {
  // puuid+category별로 그룹핑
  const groups = {};
  for (const unlock of achievements) {
    const def = defMap[unlock.achievementId];
    if (!def) continue;
    const key = unlock.puuid + '|' + def.category;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ unlock, def });
  }

  const result = [];
  for (const entries of Object.values(groups)) {
    if (entries.length === 1) {
      result.push(entries[0].unlock);
    } else {
      // 같은 카테고리가 여러 개면 티어가 가장 높은 것만
      entries.sort(function(a, b) {
        return TIERS.indexOf(b.def.tier) - TIERS.indexOf(a.def.tier);
      });
      result.push(entries[0].unlock);
    }
  }
  return result;
}

async function sendAchievementNotification(channel, newAchievements, groupId) {
  try {
    if (!newAchievements || newAchievements.length === 0) return;

    const defMap = {};
    definitions.forEach((d) => { defMap[d.id] = d; });

    // 같은 유저+카테고리에서 가장 높은 티어 업적만 표시
    const filtered = filterHighestPerCategory(newAchievements, defMap);

    // 소환사 이름 조회
    const puuids = [...new Set(filtered.map((a) => a.puuid))];
    const summoners = await models.summoner.findAll({
      where: { puuid: puuids },
      attributes: ['puuid', 'name'],
    });
    const nameMap = {};
    summoners.forEach((s) => { nameMap[s.puuid] = s.name; });

    // 가장 높은 티어 색상 사용
    const tierOrder = Object.keys(TIER_COLORS);
    let highestTierIdx = 0;
    const lines = filtered.map((unlock) => {
      const def = defMap[unlock.achievementId];
      if (!def) return null;
      const name = nameMap[unlock.puuid] || '알 수 없음';
      const tierIdx = tierOrder.indexOf(def.tier);
      if (tierIdx > highestTierIdx) highestTierIdx = tierIdx;
      const prefix = def.emoji ? `${def.emoji} ` : '';
      return `${prefix}**${name}** — ${def.name}`;
    }).filter(Boolean);

    if (lines.length === 0) return;

    const embed = new EmbedBuilder()
      .setColor(TIER_COLORS[tierOrder[highestTierIdx]] || '#FFD700')
      .setTitle('🏆 업적 달성!')
      .setDescription(lines.join('\n'));

    await channel.send({ embeds: [embed] });
  } catch (e) {
    logger.error('업적 알림 전송 오류:', e);
  }
}

module.exports = { sendAchievementNotification };
