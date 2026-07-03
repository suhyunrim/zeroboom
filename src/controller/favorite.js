const models = require('../db/models');

const MAX_FAVORITES = 10;

/**
 * 즐겨찾기 목록 조회 (등록순).
 */
const getList = async ({ groupId, ownerDiscordId }) => {
  return models.user_favorite.findAll({
    where: { groupId, ownerDiscordId },
    order: [['id', 'ASC']],
  });
};

/**
 * 즐겨찾기 추가. 성공 시 { favorite }, 실패 시 { error } 반환.
 */
const add = async ({ groupId, ownerDiscordId, targetPuuid }) => {
  // 본캐만 대상 (부캐/미등록 puuid 방지)
  const target = await models.user.findOne({
    where: { groupId, puuid: targetPuuid, primaryPuuid: null },
  });
  if (!target) return { error: '그룹에서 대상 유저를 찾을 수 없습니다.' };

  const count = await models.user_favorite.count({ where: { groupId, ownerDiscordId } });
  if (count >= MAX_FAVORITES) {
    return { error: `즐겨찾기는 최대 ${MAX_FAVORITES}명까지 등록할 수 있습니다.` };
  }

  try {
    const favorite = await models.user_favorite.create({ groupId, ownerDiscordId, targetPuuid });
    return { favorite };
  } catch (e) {
    // 중복 등록은 unique index에 맡긴다 (더블클릭 등 동시 요청도 안전)
    if (e.name === 'SequelizeUniqueConstraintError') {
      return { error: '이미 즐겨찾기에 등록된 유저입니다.' };
    }
    throw e;
  }
};

/**
 * 즐겨찾기 제거 (idempotent). 삭제된 row 수 반환.
 */
const remove = async ({ groupId, ownerDiscordId, targetPuuid }) => {
  return models.user_favorite.destroy({
    where: { groupId, ownerDiscordId, targetPuuid },
  });
};

module.exports = {
  MAX_FAVORITES,
  getList,
  add,
  remove,
};
