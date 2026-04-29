const models = require('../db/models');

/**
 * 같은 그룹의 puuid → discordId 매핑 일괄 조회.
 * discordId가 없는 user는 결과에서 제외.
 */
const fetchDiscordIdMap = async (groupId, puuids) => {
  const valid = (puuids || []).filter(Boolean);
  if (!groupId || valid.length === 0) return {};
  const rows = await models.user.findAll({
    where: { groupId, puuid: valid },
    attributes: ['puuid', 'discordId'],
  });
  const map = {};
  rows.forEach((u) => {
    if (u.discordId) map[u.puuid] = u.discordId;
  });
  return map;
};

module.exports = { fetchDiscordIdMap };
