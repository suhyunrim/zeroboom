const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const { verifyToken } = require('../middlewares/auth');
const models = require('../../db/models');
const favoriteController = require('../../controller/favorite');

const route = Router();

/**
 * 즐겨찾기 대상의 표시 정보(name/profileIconId/rankTier/rating)를
 * active-members와 동일한 형식으로 변환. 탈퇴 표시용 leftGuildAt 포함.
 */
const enrichFavorites = async (groupId, favorites) => {
  const puuids = favorites.map((f) => f.targetPuuid);
  if (!puuids.length) return [];

  const [users, summoners] = await Promise.all([
    models.user.findAll({
      where: { groupId, puuid: puuids },
      attributes: ['puuid', 'defaultRating', 'additionalRating', 'leftGuildAt'],
    }),
    models.summoner.findAll({
      where: { puuid: puuids },
      attributes: ['puuid', 'name', 'profileIconId', 'rankTier'],
    }),
  ]);

  const userByPuuid = {};
  users.forEach((u) => {
    userByPuuid[u.puuid] = u;
  });
  const summonerByPuuid = {};
  summoners.forEach((s) => {
    summonerByPuuid[s.puuid] = s;
  });

  return favorites
    .map((f) => {
      const u = userByPuuid[f.targetPuuid];
      const s = summonerByPuuid[f.targetPuuid];
      return {
        puuid: f.targetPuuid,
        name: s ? s.name : null,
        profileIconId: s ? s.profileIconId : null,
        rankTier: s ? s.rankTier : null,
        rating: u ? (u.defaultRating || 0) + (u.additionalRating || 0) : null,
        leftGuildAt: u ? u.leftGuildAt : null,
      };
    })
    .filter((m) => m.name);
};

module.exports = (app) => {
  app.use('/favorites', route);

  /**
   * GET /api/favorites?groupId=N
   * 내 즐겨찾기 목록 (등록순, 최대 10명).
   * 응답: [{ puuid, name, profileIconId, rankTier, rating, leftGuildAt }]
   */
  route.get('/', verifyToken, async (req, res) => {
    const groupId = Number(req.query.groupId);
    if (!groupId) return res.status(400).json({ result: 'groupId가 필요합니다.' });

    try {
      const favorites = await favoriteController.getList({
        groupId,
        ownerDiscordId: req.user.discordId,
      });
      const result = await enrichFavorites(groupId, favorites);
      return res.status(200).json({ result });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * POST /api/favorites
   * body: { groupId, puuid }
   * 최대 10명 / 중복 / 그룹 미소속 대상은 400.
   */
  route.post('/', verifyToken, async (req, res) => {
    const { groupId, puuid } = req.body || {};
    if (!Number(groupId) || !puuid) {
      return res.status(400).json({ result: 'groupId, puuid가 필요합니다.' });
    }

    try {
      const { error } = await favoriteController.add({
        groupId: Number(groupId),
        ownerDiscordId: req.user.discordId,
        targetPuuid: puuid,
      });
      if (error) return res.status(400).json({ result: error });
      return res.status(200).json({ result: 'ok' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * DELETE /api/favorites/:puuid?groupId=N
   * idempotent — 이미 없는 대상도 ok.
   */
  route.delete('/:puuid', verifyToken, async (req, res) => {
    const groupId = Number(req.query.groupId);
    if (!groupId) return res.status(400).json({ result: 'groupId가 필요합니다.' });

    try {
      await favoriteController.remove({
        groupId,
        ownerDiscordId: req.user.discordId,
        targetPuuid: req.params.puuid,
      });
      return res.status(200).json({ result: 'ok' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });
};
