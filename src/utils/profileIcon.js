const models = require('../db/models');

/**
 * puuid 배열로 summoner.profileIconId 일괄 조회.
 * 응답: { puuid: profileIconId|null }
 */
const fetchProfileIconMap = async (puuids) => {
  const valid = (puuids || []).filter(Boolean);
  if (valid.length === 0) return {};
  const rows = await models.summoner.findAll({
    where: { puuid: valid },
    attributes: ['puuid', 'profileIconId'],
  });
  const map = {};
  rows.forEach((s) => {
    map[s.puuid] = s.profileIconId;
  });
  return map;
};

module.exports = { fetchProfileIconMap };
