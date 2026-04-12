const { Router } = require('express');
const models = require('../../db/models');
const { logger } = require('../../loaders/logger');
const { verifyToken, requireGroupAdmin } = require('../middlewares/auth');
const { getRating, convertAbbreviationTier, isValidTier } = require('../../services/user');
const challengeController = require('../../controller/challenge');
const auditLog = require('../../controller/audit-log');

const route = Router();

module.exports = (app) => {
  app.use('/group', route);

  /**
   * GET /api/group/:groupId/members
   * 그룹 멤버 목록 조회 (관리자 전용)
   * 블랙리스트(outsider) 여부 포함
   */
  route.get('/:groupId/members', verifyToken, requireGroupAdmin, async (req, res) => {
    const { groupId } = req.params;

    try {
      const users = await models.user.findAll({
        where: { groupId: Number(groupId) },
        attributes: [
          'puuid',
          'primaryPuuid',
          'discordId',
          'role',
          'win',
          'lose',
          'defaultRating',
          'additionalRating',
          'latestMatchDate',
          'leftGuildAt',
          'createdAt',
        ],
        order: [['createdAt', 'ASC']],
      });

      // 본캐/부캐 분리
      const mainUsers = users.filter((u) => !u.primaryPuuid);
      const subAccounts = users.filter((u) => u.primaryPuuid);

      // 본캐 puuid → 부캐 목록 매핑
      const subAccountMap = {};
      subAccounts.forEach((sub) => {
        if (!subAccountMap[sub.primaryPuuid]) subAccountMap[sub.primaryPuuid] = [];
        subAccountMap[sub.primaryPuuid].push(sub.puuid);
      });

      const allPuuids = users.map((u) => u.puuid);
      const discordIds = mainUsers.map((u) => u.discordId).filter(Boolean);
      const [summoners, group] = await Promise.all([
        models.summoner.findAll({
          where: { puuid: allPuuids },
          attributes: ['puuid', 'name'],
        }),
        models.group.findByPk(Number(groupId), { attributes: ['discordGuildId'] }),
      ]);
      const nameMap = summoners.reduce((acc, s) => {
        acc[s.puuid] = s.name;
        return acc;
      }, {});

      const voiceMap = {};
      if (group && group.discordGuildId && discordIds.length > 0) {
        const activities = await models.voice_activity.findAll({
          where: { guildId: group.discordGuildId, discordId: discordIds },
          attributes: ['discordId', 'lastJoinedAt'],
        });
        activities.forEach((a) => {
          voiceMap[a.discordId] = a.lastJoinedAt;
        });
      }

      const result = mainUsers.map((u) => {
        const subPuuids = subAccountMap[u.puuid] || [];
        const entry = {
          puuid: u.puuid,
          discordId: u.discordId,
          name: nameMap[u.puuid] || '알 수 없음',
          role: u.role,
          win: u.win,
          lose: u.lose,
          defaultRating: u.defaultRating,
          additionalRating: u.additionalRating,
          rating: u.defaultRating + u.additionalRating,
          latestMatchDate: u.latestMatchDate,
          lastVoiceJoinedAt: voiceMap[u.discordId] || null,
          leftGuildAt: u.leftGuildAt,
          createdAt: u.createdAt,
        };
        if (subPuuids.length > 0) {
          entry.subAccounts = subPuuids.map((sp) => ({
            puuid: sp,
            name: nameMap[sp] || '알 수 없음',
          }));
        }
        return entry;
      });

      return res.status(200).json({ result });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });

  /**
   * GET /api/group/:groupId/blacklist
   * 블랙리스트 조회 (관리자 전용)
   */
  route.get('/:groupId/blacklist', verifyToken, requireGroupAdmin, async (req, res) => {
    const { groupId } = req.params;

    try {
      const blacklisted = await models.user.findAll({
        where: { groupId: Number(groupId), role: 'outsider' },
        attributes: ['puuid', 'discordId', 'createdAt'],
      });

      const puuids = blacklisted.map((u) => u.puuid);
      const summoners = await models.summoner.findAll({
        where: { puuid: puuids },
        attributes: ['puuid', 'name'],
      });
      const nameMap = summoners.reduce((acc, s) => {
        acc[s.puuid] = s.name;
        return acc;
      }, {});

      const result = blacklisted.map((u) => ({
        puuid: u.puuid,
        discordId: u.discordId,
        name: nameMap[u.puuid] || '알 수 없음',
      }));

      return res.status(200).json({ result });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });

  /**
   * POST /api/group/:groupId/blacklist
   * 블랙리스트 등록 (관리자 전용)
   * body: { puuid }
   */
  route.post('/:groupId/blacklist', verifyToken, requireGroupAdmin, async (req, res) => {
    const { groupId } = req.params;
    const { puuid } = req.body;

    if (!puuid) {
      return res.status(400).json({ result: 'puuid가 필요합니다.' });
    }

    try {
      const user = await models.user.findOne({
        where: { puuid, groupId: Number(groupId) },
      });

      if (!user) {
        return res.status(404).json({ result: '해당 유저를 찾을 수 없습니다.' });
      }

      if (user.role === 'outsider') {
        return res.status(400).json({ result: '이미 블랙리스트에 등록된 유저입니다.' });
      }

      await models.user.update({ role: 'outsider' }, { where: { puuid, groupId: Number(groupId) } });
      await challengeController.invalidateLeaderboardCache(Number(groupId));

      auditLog.log({
        groupId: Number(groupId),
        actorDiscordId: req.user.discordId,
        actorName: req.user.name,
        action: 'user.blacklist',
        details: { puuid, previousRole: user.role },
        source: 'web',
      });

      return res.status(200).json({ result: '블랙리스트에 등록되었습니다.' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });

  /**
   * PATCH /api/group/:groupId/members/:puuid/rating
   * 멤버 기본 레이팅 수정 (관리자 전용)
   * body: { tier } — "D4", "E3", "GOLD II" 등
   */
  route.patch('/:groupId/members/:puuid/rating', verifyToken, requireGroupAdmin, async (req, res) => {
    const { groupId, puuid } = req.params;
    const { tier } = req.body;

    if (!tier) {
      return res.status(400).json({ result: 'tier가 필요합니다. (예: D4, E3, GOLD II)' });
    }

    const fullTier = convertAbbreviationTier(tier);
    if (!isValidTier(fullTier)) {
      return res.status(400).json({ result: `유효하지 않은 티어입니다: ${tier}` });
    }

    try {
      const user = await models.user.findOne({
        where: { puuid, groupId: Number(groupId) },
      });

      if (!user) {
        return res.status(404).json({ result: '해당 유저를 찾을 수 없습니다.' });
      }

      const oldRating = user.defaultRating;
      const newRating = getRating(fullTier);
      await models.user.update({ defaultRating: newRating }, { where: { puuid, groupId: Number(groupId) } });

      auditLog.log({
        groupId: Number(groupId),
        actorDiscordId: req.user.discordId,
        actorName: req.user.name,
        action: 'user.rating_change',
        details: { puuid, tier: fullTier, before: oldRating, after: newRating },
        source: 'web',
      });

      return res.status(200).json({
        result: {
          message: `기본 레이팅이 ${fullTier} (${newRating})으로 변경되었습니다.`,
          defaultRating: newRating,
          tier: fullTier,
        },
      });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });

  /**
   * DELETE /api/group/:groupId/blacklist/:puuid
   * 블랙리스트 해제 (관리자 전용)
   */
  route.delete('/:groupId/blacklist/:puuid', verifyToken, requireGroupAdmin, async (req, res) => {
    const { groupId, puuid } = req.params;

    try {
      const user = await models.user.findOne({
        where: { puuid, groupId: Number(groupId) },
      });

      if (!user) {
        return res.status(404).json({ result: '해당 유저를 찾을 수 없습니다.' });
      }

      if (user.role !== 'outsider') {
        return res.status(400).json({ result: '블랙리스트에 등록되지 않은 유저입니다.' });
      }

      await models.user.update({ role: 'member' }, { where: { puuid, groupId: Number(groupId) } });
      await challengeController.invalidateLeaderboardCache(Number(groupId));

      auditLog.log({
        groupId: Number(groupId),
        actorDiscordId: req.user.discordId,
        actorName: req.user.name,
        action: 'user.unblacklist',
        details: { puuid },
        source: 'web',
      });

      return res.status(200).json({ result: '블랙리스트에서 해제되었습니다.' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });
};
