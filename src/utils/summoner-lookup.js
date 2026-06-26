const { Op } = require('sequelize');

/**
 * 그룹 멤버 중에서 이름이 일치하는 소환사 모델을 반환한다(없으면 null).
 *
 * summoner 테이블은 puuid 기준 전역이라 같은 이름의 소환사가 여러 그룹에 있거나
 * orphan(어느 그룹에도 등록 안 됨)일 수 있다. 이름으로 "전역 findOne" 후 그룹 멤버인지
 * 확인하는 방식은, 엉뚱한 동명이인을 먼저 집어 그룹 멤버를 못 찾는 버그를 낸다.
 * → 이름 매칭 후보를 모은 뒤 "이 그룹 user인 puuid"로 스코프해 고른다.
 *
 * @param {object} models - sequelize 모델 묶음
 * @param {number} groupId
 * @param {object} where - summoner 검색 조건 (예: { simplifiedName } 또는 { name })
 * @returns {Promise<object|null>} 매칭된 summoner 모델 인스턴스 또는 null
 */
async function findGroupSummoner(models, groupId, where) {
  const candidates = await models.summoner.findAll({ where, attributes: ['puuid'], raw: true });
  if (!candidates.length) return null;
  const user = await models.user.findOne({
    where: { groupId, puuid: { [Op.in]: candidates.map((c) => c.puuid) } },
    attributes: ['puuid'],
    raw: true,
  });
  if (!user) return null;
  return models.summoner.findOne({ where: { puuid: user.puuid } });
}

module.exports = { findGroupSummoner };
