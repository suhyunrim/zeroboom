const models = require('../../db/models');

/**
 * user_achievement_stats 조작 헬퍼.
 * 원자적 upsert로 동시 매치 처리 시 race 방지.
 */

function incrementStat(puuid, groupId, statType, delta = 1) {
  return models.sequelize.query(
    `INSERT INTO user_achievement_stats (puuid, groupId, statType, value, createdAt, updatedAt)
     VALUES (:puuid, :groupId, :statType, :delta, NOW(), NOW())
     ON DUPLICATE KEY UPDATE value = value + :delta, updatedAt = NOW()`,
    { replacements: { puuid, groupId, statType, delta } },
  );
}

function setStat(puuid, groupId, statType, value) {
  return models.sequelize.query(
    `INSERT INTO user_achievement_stats (puuid, groupId, statType, value, createdAt, updatedAt)
     VALUES (:puuid, :groupId, :statType, :value, NOW(), NOW())
     ON DUPLICATE KEY UPDATE value = :value, updatedAt = NOW()`,
    { replacements: { puuid, groupId, statType, value } },
  );
}

function updateBestStat(puuid, groupId, statType, value) {
  return models.sequelize.query(
    `INSERT INTO user_achievement_stats (puuid, groupId, statType, value, createdAt, updatedAt)
     VALUES (:puuid, :groupId, :statType, :value, NOW(), NOW())
     ON DUPLICATE KEY UPDATE value = GREATEST(value, :value), updatedAt = NOW()`,
    { replacements: { puuid, groupId, statType, value } },
  );
}

module.exports = { incrementStat, setStat, updateBestStat };
