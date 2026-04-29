const { Router } = require('express');

const route = Router();
const { Op } = require('sequelize');
const { logger } = require('../../loaders/logger');
const models = require('../../db/models');
const { verifyToken, requireGroupAdmin } = require('../middlewares/auth');

const { getGuildIconUrl } = require('../../utils/discordUtils');
const auditLog = require('../../controller/audit-log');
const groupController = require('../../controller/group');
const seasonController = require('../../controller/season');
const tokenController = require('../../controller/token');

module.exports = (app) => {
  app.use('/group', route);

  // 방 정보 조회
  route.get('/:groupId/info', verifyToken, requireGroupAdmin, async (req, res) => {
    try {
      const group = await models.group.findByPk(Number(req.params.groupId));
      if (!group) return res.status(404).json({ result: '그룹을 찾을 수 없습니다.' });

      const [totalMembers, activeMembers, blacklistedMembers, leftGuildMembers, totalMatches] = await Promise.all([
        models.user.count({ where: { groupId: group.id } }),
        models.user.count({ where: { groupId: group.id, role: { [Op.ne]: 'outsider' }, leftGuildAt: null } }),
        models.user.count({ where: { groupId: group.id, role: 'outsider' } }),
        models.user.count({ where: { groupId: group.id, leftGuildAt: { [Op.ne]: null } } }),
        models.match.count({ where: { groupId: group.id } }),
      ]);

      const client = req.app.discordClient;
      const guild = group.discordGuildId ? client.guilds.cache.get(group.discordGuildId) : null;

      return res.json({
        id: group.id,
        groupName: group.groupName,
        discordGuildName: guild ? guild.name : null,
        discordGuildIcon: group.discordGuildId ? getGuildIconUrl(client, group.discordGuildId) : null,
        members: {
          total: totalMembers,
          active: activeMembers,
          blacklisted: blacklistedMembers,
          leftGuild: leftGuildMembers,
        },
        totalMatches,
        settings: group.settings || {},
        createdAt: group.createdAt,
      });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });

  /**
   * GET /api/group/:groupId/members
   * 멘션·태그 목록용. 본캐(primaryPuuid: null) + outsider 제외 + 길드 잔류자만.
   * 응답: [{ puuid, name, avatarUrl }]
   */
  route.get('/:groupId/members', async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (!groupId) return res.status(400).json({ result: 'groupId가 필요합니다.' });

    try {
      const users = await models.user.findAll({
        where: {
          groupId,
          primaryPuuid: null,
          role: { [Op.ne]: 'outsider' },
          leftGuildAt: null,
        },
        attributes: ['puuid', 'discordId'],
      });

      const puuids = users.map((u) => u.puuid);
      const summoners = puuids.length
        ? await models.summoner.findAll({
            where: { puuid: puuids },
            attributes: ['puuid', 'name', 'profileIconId'],
          })
        : [];
      const summonerByPuuid = {};
      summoners.forEach((s) => {
        summonerByPuuid[s.puuid] = s;
      });

      const result = users
        .map((u) => {
          const s = summonerByPuuid[u.puuid];
          return {
            puuid: u.puuid,
            name: s ? s.name : null,
            profileIconId: s ? s.profileIconId : null,
          };
        })
        .filter((m) => m.name);

      return res.status(200).json({ result });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  // 방 이름 변경
  route.patch('/:groupId/name', verifyToken, requireGroupAdmin, async (req, res) => {
    const { groupName } = req.body;
    if (!groupName) return res.status(400).json({ result: 'groupName은 필수입니다.' });

    const group = await models.group.findByPk(Number(req.params.groupId));
    if (!group) return res.status(404).json({ result: '그룹을 찾을 수 없습니다.' });

    const oldName = group.groupName;
    await group.update({ groupName });

    auditLog.log({
      groupId: group.id,
      actorDiscordId: req.user.discordId,
      actorName: req.user.name,
      action: 'group.rename',
      details: { before: oldName, after: groupName },
      source: 'web',
    });

    return res.json({ groupName });
  });

  route.get('/ranking/period', async (req, res) => {
    const { groupId, startDate, endDate } = req.query;

    if (!groupId || !startDate || !endDate) {
      return res.status(400).json({ result: 'groupId, startDate, endDate가 필요합니다.' });
    }

    try {
      const result = await groupController.getRankingByPeriod(Number(groupId), new Date(startDate), new Date(endDate));
      const response = { result: result.result };

      // 요청자의 기간 랭킹 정보 추가 (puuid 헤더로 식별)
      const myPuuid = req.headers.puuid;
      if (myPuuid && result.status === 200) {
        response.myRanking = await groupController.getMyRankingByPeriod(Number(groupId), myPuuid, result.result);
      }

      return res.status(result.status).json(response);
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

    auditLog.log({
      groupId: group.id,
      actorDiscordId: req.user.discordId,
      actorName: req.user.name,
      action: 'group.settings.update',
      details: { before: currentSettings, after: newSettings },
      source: 'web',
    });

    return res.json(newSettings);
  });

  // Discord 서버 역할 목록 조회
  route.get('/:groupId/discord-roles', verifyToken, requireGroupAdmin, async (req, res) => {
    try {
      const group = await models.group.findByPk(Number(req.params.groupId));
      if (!group) return res.status(404).json({ result: '그룹을 찾을 수 없습니다.' });
      if (!group.discordGuildId) return res.status(400).json({ result: 'Discord 서버가 연결되지 않았습니다.' });

      const client = req.app.discordClient;
      const guild = client.guilds.cache.get(group.discordGuildId);
      if (!guild) return res.status(404).json({ result: 'Discord 서버를 찾을 수 없습니다.' });

      const roles = guild.roles.cache
        .filter((role) => !role.managed && role.id !== guild.id) // 봇 관리 역할, @everyone 제외
        .sort((a, b) => b.position - a.position)
        .map((role) => ({
          id: role.id,
          name: role.name,
          color: role.hexColor,
          position: role.position,
        }));

      return res.json(roles);
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });

  // 시즌 초기화
  route.post('/:groupId/season/reset', verifyToken, requireGroupAdmin, async (req, res) => {
    try {
      const groupId = Number(req.params.groupId);
      const result = await seasonController.resetSeason(groupId, req.user.discordId, req.user.name);
      return res.json(result);
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });

  // 시즌 스냅샷 조회
  route.get('/:groupId/season/snapshots', verifyToken, async (req, res) => {
    try {
      const groupId = Number(req.params.groupId);
      const { season } = req.query;
      const where = { groupId };
      if (season) where.season = Number(season);

      const snapshots = await models.season_snapshot.findAll({
        where,
        order: [
          ['season', 'DESC'],
          ['additionalRating', 'DESC'],
        ],
      });
      return res.json(snapshots);
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });

  route.get('/ranking', async (req, res) => {
    const { groupName } = req.query;

    if (!groupName) return res.status(501).json({ result: 'invalid group name' });

    try {
      const tokenId = req.headers.riottokenid;
      await tokenController.validateUserGroup(tokenId, groupName);

      const rankings = await groupController.getRanking(groupName);
      const response = { result: rankings.result };

      // 요청자의 랭킹 정보 추가
      const myPuuid = req.headers.puuid;
      if (myPuuid && rankings.status === 200) {
        response.myRanking = await groupController.getMyRanking(groupName, myPuuid, rankings.result);
      }

      return res.status(rankings.status).json(response);
    } catch (e) {
      logger.error(e);
      return res.status(501).json({ result: e.message });
    }
  });
};
