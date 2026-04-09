const { Router } = require('express');

const route = Router();
const { logger } = require('../../loaders/logger');
const models = require('../../db/models');
const { verifyToken, requireGroupAdmin } = require('../middlewares/auth');

const groupController = require('../../controller/group');
const tokenController = require('../../controller/token');

module.exports = (app) => {
  app.use('/group', route);

  route.get('/ranking/period', async (req, res) => {
    const { groupId, startDate, endDate } = req.query;

    if (!groupId || !startDate || !endDate) {
      return res.status(400).json({ result: 'groupId, startDate, endDate가 필요합니다.' });
    }

    try {
      const result = await groupController.getRankingByPeriod(
        Number(groupId),
        new Date(startDate),
        new Date(endDate),
      );
      return res.status(result.status).json({ result: result.result });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });

  // 그룹 설정 조회
  route.get('/:groupId/settings', verifyToken, requireGroupAdmin, async (req, res) => {
    const group = await models.group.findByPk(Number(req.params.groupId), { attributes: ['settings'] });
    if (!group) return res.status(404).json({ result: '그룹을 찾을 수 없습니다.' });
    return res.json(group.settings || {});
  });

  // 그룹 설정 업데이트
  route.patch('/:groupId/settings', verifyToken, requireGroupAdmin, async (req, res) => {
    const group = await models.group.findByPk(Number(req.params.groupId));
    if (!group) return res.status(404).json({ result: '그룹을 찾을 수 없습니다.' });
    const currentSettings = group.settings || {};
    const newSettings = { ...currentSettings, ...req.body };
    await group.update({ settings: newSettings });
    return res.json(newSettings);
  });

  route.get('/ranking', async (req, res) => {
    const { groupName } = req.query;

    if (!groupName)
      return res.status(501).json({ result: 'invalid group name' });

    try {
      const tokenId = req.headers.riottokenid;
      await tokenController.validateUserGroup(tokenId, groupName);

      const rankings = await groupController.getRanking(groupName);
      return res.status(rankings.status).json({ result: rankings.result });
    } catch (e) {
      logger.error(e);
      return res.status(501).json({ result: e.message });
    }
  });
};
