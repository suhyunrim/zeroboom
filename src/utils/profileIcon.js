const models = require('../db/models');

/**
 * puuid 배열로 summoner.name + profileIconId 일괄 조회.
 * 응답: { puuid: { name, profileIconId } }
 * 댓글/좋아요/알림 응답에서 LoL 닉/아이콘으로 표시할 때 사용.
 */
const fetchSummonerSummaryMap = async (puuids) => {
  const valid = (puuids || []).filter(Boolean);
  if (valid.length === 0) return {};
  const rows = await models.summoner.findAll({
    where: { puuid: valid },
    attributes: ['puuid', 'name', 'profileIconId'],
  });
  const map = {};
  rows.forEach((s) => {
    map[s.puuid] = { name: s.name, profileIconId: s.profileIconId };
  });
  return map;
};

module.exports = { fetchSummonerSummaryMap };
