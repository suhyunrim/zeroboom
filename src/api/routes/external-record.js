const { Router } = require('express');
const models = require('../../db/models');
const { Op } = require('sequelize');
const { logger } = require('../../loaders/logger');
const { addDays } = require('../../utils/timeUtils');

const route = Router();

module.exports = (app) => {
  app.use('/external-record', route);

  // 외부 승/패 기록 생성
  route.post('/', async (req, res) => {
    const { puuid, groupId, win, lose, expireDays, description } = req.body;

    if (!puuid || !groupId) {
      return res.status(400).json({ result: 'puuid와 groupId는 필수입니다.' });
    }

    if ((!win && !lose) || (win === 0 && lose === 0)) {
      return res.status(400).json({ result: 'win 또는 lose 값이 필요합니다.' });
    }

    if (!expireDays || expireDays <= 0) {
      return res.status(400).json({ result: 'expireDays는 1 이상이어야 합니다.' });
    }

    try {
      const expiresAt = addDays(new Date(), expireDays);

      const record = await models.externalRecord.create({
        puuid,
        groupId,
        win: win || 0,
        lose: lose || 0,
        description: description || null,
        expiresAt,
      });

      return res.status(200).json({ result: record });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });

  // 그룹의 외부 기록 목록 조회
  route.get('/:groupId', async (req, res) => {
    const { groupId } = req.params;

    try {
      // outsider 제외
      const outsiders = await models.user.findAll({
        where: { groupId, role: 'outsider' },
        attributes: ['puuid'],
        raw: true,
      });
      const outsiderPuuids = outsiders.map((u) => u.puuid);

      const records = await models.externalRecord.findAll({
        where: {
          groupId,
          expiresAt: { [Op.gt]: new Date() },
          ...(outsiderPuuids.length > 0 && { puuid: { [Op.notIn]: outsiderPuuids } }),
        },
        order: [['createdAt', 'DESC']],
      });

      return res.status(200).json({ result: records });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });

  // 외부 기록 삭제
  route.delete('/:id', async (req, res) => {
    const { id } = req.params;

    try {
      const record = await models.externalRecord.findByPk(id);
      if (!record) {
        return res.status(404).json({ result: '기록을 찾을 수 없습니다.' });
      }

      await record.destroy();
      return res.status(200).json({ result: '삭제되었습니다.' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });
};
