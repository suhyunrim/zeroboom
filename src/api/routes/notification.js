const { Router } = require('express');
const { Op } = require('sequelize');
const { logger } = require('../../loaders/logger');
const { verifyToken } = require('../middlewares/auth');
const models = require('../../db/models');
const notificationController = require('../../controller/notification');
const { getUserAvatarUrl } = require('../../utils/discordUtils');

const route = Router();

/**
 * actor 본캐 puuid를 (groupId, discordId) 단위로 일괄 조회.
 * 부캐(primaryPuuid != null)는 제외 — 알림 클릭 시 본캐 프로필로 이동.
 */
const fetchActorPuuidMap = async (groups) => {
  const pairs = new Set();
  groups.forEach((g) => {
    if (!g.groupId) return;
    g.actors.forEach((a) => {
      if (a.discordId) pairs.add(`${g.groupId}:${a.discordId}`);
    });
  });
  if (pairs.size === 0) return {};

  const orClauses = [...pairs].map((p) => {
    const [gid, did] = p.split(':');
    return { groupId: Number(gid), discordId: did };
  });
  const rows = await models.user.findAll({
    where: { [Op.or]: orClauses, primaryPuuid: null },
    attributes: ['groupId', 'discordId', 'puuid'],
  });
  const map = {};
  rows.forEach((u) => {
    map[`${u.groupId}:${u.discordId}`] = u.puuid;
  });
  return map;
};

const sanitizeGroup = (g, { puuidMap = {}, client = null } = {}) => ({
  key: g.key,
  type: g.type,
  targetKey: g.targetKey,
  groupId: g.groupId,
  latestAt: g.latestAt,
  hasUnread: g.hasUnread,
  count: g.count,
  actors: g.actors.map((a) => ({
    discordId: a.discordId,
    name: a.name,
    puuid: g.groupId ? puuidMap[`${g.groupId}:${a.discordId}`] || null : null,
    avatarUrl: getUserAvatarUrl(client, a.discordId),
  })),
  // 가장 최근 1건의 payload를 대표로 노출 (UI에서 텍스트/링크 구성용)
  latestPayload: g.items[0] ? g.items[0].payload : null,
  latestActorName: g.items[0] ? g.items[0].actorName : null,
  // 그룹의 대표 id — read 처리/이동에 활용
  representativeId: g.items[0] ? g.items[0].id : null,
});

module.exports = (app) => {
  app.use('/notifications', route);

  /**
   * GET /api/notifications
   * 내 알림 목록 (그룹화, 최신순). limit 기본 50.
   */
  route.get('/', verifyToken, async (req, res) => {
    const { discordId } = req.user;
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    try {
      const groups = await notificationController.getList(discordId, { limit });
      const puuidMap = await fetchActorPuuidMap(groups);
      const client = req.app.discordClient;
      return res.status(200).json({
        result: groups.map((g) => sanitizeGroup(g, { puuidMap, client })),
      });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * GET /api/notifications/unread-count
   * 미읽음 그룹 수 (벨 빨간 점용).
   */
  route.get('/unread-count', verifyToken, async (req, res) => {
    const { discordId } = req.user;
    try {
      const count = await notificationController.getUnreadGroupCount(discordId);
      return res.status(200).json({ result: { count } });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * POST /api/notifications/read-all
   * 전체 읽음 처리.
   */
  route.post('/read-all', verifyToken, async (req, res) => {
    const { discordId } = req.user;
    try {
      await notificationController.markAllRead(discordId);
      return res.status(200).json({ result: 'ok' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * POST /api/notifications/read
   * 특정 그룹 읽음 처리.
   * body: { type?, targetKey?, id? } — targetKey 있으면 그룹 단위, 없으면 id 단위.
   */
  route.post('/read', verifyToken, async (req, res) => {
    const { discordId } = req.user;
    const { type, targetKey, id } = req.body;

    if (!targetKey && !id) {
      return res.status(400).json({ result: 'targetKey 또는 id가 필요합니다.' });
    }

    try {
      await notificationController.markGroupRead({
        recipientDiscordId: discordId,
        type,
        targetKey,
        id: id ? Number(id) : null,
      });
      return res.status(200).json({ result: 'ok' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });
};
