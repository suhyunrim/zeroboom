const { Router } = require('express');
const models = require('../../db/models');
const { definitions } = require('../../services/achievement/definitions');
const achievementController = require('../../controller/achievement');
const { logger } = require('../../loaders/logger');

const route = Router();

const wrapRoute = (handler, { notFoundMessage } = {}) => async (req, res) => {
  try {
    const data = await handler(req);
    if (data === null && notFoundMessage) {
      return res.status(404).json({ result: notFoundMessage });
    }
    return res.status(200).json({ result: data });
  } catch (e) {
    logger.error(e);
    return res.status(500).json({ result: e.message });
  }
};

module.exports = (app) => {
  app.use('/achievement', route);

  // 그룹 업적 대시보드 요약 (카드 목록은 /category/:category 로 분리)
  route.get('/:groupId/dashboard', wrapRoute((req) =>
    achievementController.getDashboard(Number(req.params.groupId)),
  ));

  route.get('/:groupId/category/:category', wrapRoute(
    (req) => achievementController.getCategoryAchievements(Number(req.params.groupId), req.params.category),
    { notFoundMessage: '해당 카테고리를 찾을 수 없습니다.' },
  ));

  route.get('/:groupId/ranking/:achievementId', wrapRoute(
    (req) => achievementController.getAchievementRanking(Number(req.params.groupId), req.params.achievementId),
    { notFoundMessage: '업적을 찾을 수 없습니다.' },
  ));

  // 개인 업적 조회 (기존)
  route.get('/:groupId/:puuid', async (req, res) => {
    const { groupId, puuid } = req.params;

    const gid = Number(groupId);
    const [unlocked, totalUsers, achievementCounts] = await Promise.all([
      models.user_achievement.findAll({
        where: { groupId: gid, puuid },
        attributes: ['achievementId', 'unlockedAt'],
      }),
      models.user.count({ where: { groupId: gid } }),
      models.user_achievement.findAll({
        where: { groupId: gid },
        attributes: ['achievementId', [models.sequelize.fn('COUNT', models.sequelize.col('achievementId')), 'cnt']],
        group: ['achievementId'],
        raw: true,
      }),
    ]);

    const unlockedMap = {};
    unlocked.forEach((u) => { unlockedMap[u.achievementId] = u.unlockedAt; });
    const countMap = {};
    achievementCounts.forEach((r) => { countMap[r.achievementId] = Number(r.cnt); });

    const result = definitions.map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      emoji: def.emoji,
      tier: def.tier,
      category: def.category,
      unlocked: !!unlockedMap[def.id],
      unlockedAt: unlockedMap[def.id] || null,
      achievementRate: totalUsers > 0 ? Math.round(((countMap[def.id] || 0) / totalUsers) * 1000) / 10 : 0,
    }));

    return res.status(200).json({ result });
  });
};
