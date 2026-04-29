const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const { verifyToken } = require('../middlewares/auth');
const models = require('../../db/models');
const { getGuildIconUrl } = require('../../utils/discordUtils');
const route = Router();
const userController = require('../../controller/user');
const summonerController = require('../../controller/summoner');
const auditLog = require('../../controller/audit-log');

const STATUS_MESSAGE_MAX_LENGTH = 200;

module.exports = (app) => {
  app.use('/user', route);

  route.post('/login', async (req, res) => {
    const { riotId } = req.body;
    try {
      if (!riotId || !riotId.includes('#')) {
        return res.status(400).json({ result: 'riotId 형식이 올바르지 않습니다. (예: 닉네임#태그)' });
      }

      const summoner = await summonerController.getSummonerByName(riotId);
      if (!summoner || !summoner.result) {
        return res.status(404).json({ result: '소환사를 찾을 수 없습니다.' });
      }

      const puuid = summoner.result.puuid;
      const groupList = await userController.getGroupList(puuid);
      const client = req.app.discordClient;
      for (const group of groupList.result) {
        group.iconUrl = getGuildIconUrl(client, group.discordGuildId);
      }

      return res.status(200).json({
        puuid,
        name: riotId,
        groupList: groupList.result,
      });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.get('/getGroupList', async (req, res) => {
    try {
      const puuid = req.headers.puuid;
      if (!puuid) {
        return res.status(400).json({ result: 'puuid가 필요합니다.' });
      }
      const groupList = await userController.getGroupList(puuid);
      const client = req.app.discordClient;
      for (const group of groupList.result) {
        group.iconUrl = getGuildIconUrl(client, group.discordGuildId);
      }
      return res.status(groupList.status).json({ result: groupList.result });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * POST /api/user/sub-account
   * 부캐 등록 (Discord 인증 필요)
   * body: { riotId, groupId }
   */
  route.post('/sub-account', verifyToken, async (req, res) => {
    const { riotId, groupId } = req.body;
    const { puuid: mainPuuid } = req.user;

    if (!riotId || !groupId) {
      return res.status(400).json({ result: 'riotId와 groupId가 필요합니다.' });
    }

    try {
      // 본캐 유저 확인
      const mainUser = await models.user.findOne({
        where: { puuid: mainPuuid, groupId: Number(groupId) },
      });
      if (!mainUser) {
        return res.status(404).json({ result: '본캐가 해당 그룹에 등록되어 있지 않습니다.' });
      }
      if (mainUser.primaryPuuid) {
        return res.status(400).json({ result: '부캐 계정으로는 부캐를 등록할 수 없습니다.' });
      }

      // 부캐 소환사 조회
      const summoner = await summonerController.getSummonerByName(riotId);
      if (!summoner || !summoner.result) {
        return res.status(404).json({ result: '소환사를 찾을 수 없습니다.' });
      }
      const subPuuid = summoner.result.puuid;

      if (subPuuid === mainPuuid) {
        return res.status(400).json({ result: '본캐와 같은 계정입니다.' });
      }

      // 이미 다른 유저의 부캐로 등록되어 있는지 확인
      const existingSub = await models.user.findOne({
        where: { puuid: subPuuid, groupId: Number(groupId) },
      });
      if (existingSub) {
        return res.status(400).json({ result: '이미 그룹에 등록된 계정입니다.' });
      }

      // 본캐에 이미 부캐가 있는지 확인
      const existingLink = await models.user.findOne({
        where: { primaryPuuid: mainPuuid, groupId: Number(groupId) },
      });
      if (existingLink) {
        return res.status(400).json({ result: '이미 부캐가 등록되어 있습니다. 기존 부캐를 해제 후 등록해주세요.' });
      }

      // 부캐 유저 생성
      await models.user.create({
        puuid: subPuuid,
        groupId: Number(groupId),
        discordId: mainUser.discordId,
        primaryPuuid: mainPuuid,
        win: 0,
        lose: 0,
        defaultRating: mainUser.defaultRating,
        additionalRating: 0,
        role: 'member',
      });

      return res.status(200).json({
        result: {
          message: '부캐가 등록되었습니다.',
          subAccount: { puuid: subPuuid, name: riotId },
        },
      });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });

  /**
   * DELETE /api/user/sub-account
   * 부캐 해제 (Discord 인증 필요)
   * body: { groupId }
   */
  route.delete('/sub-account', verifyToken, async (req, res) => {
    const { groupId } = req.body;
    const { puuid: mainPuuid } = req.user;

    if (!groupId) {
      return res.status(400).json({ result: 'groupId가 필요합니다.' });
    }

    try {
      const subAccount = await models.user.findOne({
        where: { primaryPuuid: mainPuuid, groupId: Number(groupId) },
      });
      if (!subAccount) {
        return res.status(404).json({ result: '등록된 부캐가 없습니다.' });
      }

      await subAccount.destroy();

      return res.status(200).json({ result: '부캐가 해제되었습니다.' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });

  /**
   * PUT /api/user/status-message
   * 나의 한마디 등록/수정 (Discord 인증 필요, 본인 계정만 가능)
   * body: { groupId, puuid, content }
   */
  route.put('/status-message', verifyToken, async (req, res) => {
    const { groupId: rawGroupId, puuid, content } = req.body;
    const groupId = Number(rawGroupId);
    const { discordId, globalName, username } = req.user;

    if (!groupId || !puuid) {
      return res.status(400).json({ result: 'groupId와 puuid가 필요합니다.' });
    }
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ result: '내용을 입력해주세요.' });
    }
    const trimmed = content.trim();
    if (trimmed.length > STATUS_MESSAGE_MAX_LENGTH) {
      return res.status(400).json({ result: `한마디는 ${STATUS_MESSAGE_MAX_LENGTH}자 이하로 작성해주세요.` });
    }

    try {
      const target = await models.user.findOne({ where: { groupId, puuid } });
      if (!target) {
        return res.status(404).json({ result: '대상 유저가 그룹에 없습니다.' });
      }
      if (target.primaryPuuid) {
        return res.status(400).json({ result: '부캐 계정에는 한마디를 등록할 수 없습니다.' });
      }
      if (!target.discordId || target.discordId !== discordId) {
        return res.status(403).json({ result: '본인 계정에만 등록할 수 있습니다.' });
      }

      const before = target.statusMessage || null;
      const now = new Date();
      target.statusMessage = trimmed;
      target.statusMessageUpdatedAt = now;
      await target.save();

      auditLog.log({
        groupId,
        actorDiscordId: discordId,
        actorName: globalName || username || null,
        action: before ? 'user.status_message_update' : 'user.status_message_create',
        details: { puuid, before, after: trimmed },
        source: 'web',
      });

      return res.status(200).json({
        result: { content: trimmed, updatedAt: now },
      });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * DELETE /api/user/status-message
   * 나의 한마디 삭제 (Discord 인증 필요, 본인 계정만 가능)
   * body: { groupId, puuid }
   */
  route.delete('/status-message', verifyToken, async (req, res) => {
    const { groupId: rawGroupId, puuid } = req.body;
    const groupId = Number(rawGroupId);
    const { discordId, globalName, username } = req.user;

    if (!groupId || !puuid) {
      return res.status(400).json({ result: 'groupId와 puuid가 필요합니다.' });
    }

    try {
      const target = await models.user.findOne({ where: { groupId, puuid } });
      if (!target) {
        return res.status(404).json({ result: '대상 유저가 그룹에 없습니다.' });
      }
      if (target.primaryPuuid) {
        return res.status(400).json({ result: '부캐 계정에는 한마디를 등록할 수 없습니다.' });
      }
      if (!target.discordId || target.discordId !== discordId) {
        return res.status(403).json({ result: '본인 계정에만 삭제할 수 있습니다.' });
      }
      if (!target.statusMessage) {
        return res.status(404).json({ result: '등록된 한마디가 없습니다.' });
      }

      const before = target.statusMessage;
      target.statusMessage = null;
      target.statusMessageUpdatedAt = null;
      await target.save();

      auditLog.log({
        groupId,
        actorDiscordId: discordId,
        actorName: globalName || username || null,
        action: 'user.status_message_delete',
        details: { puuid, before },
        source: 'web',
      });

      return res.status(200).json({ result: '한마디가 삭제되었습니다.' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.get('/getInfo', async (req, res) => {
    const { groupId, puuid: queryPuuid } = req.query;
    try {
      const puuid = queryPuuid || req.headers.puuid;
      if (!puuid) {
        return res.status(400).json({ result: 'puuid가 필요합니다.' });
      }
      const userInfo = await userController.getInfo(groupId, puuid);
      return res.status(userInfo.status).json({ result: userInfo.result });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });
};
