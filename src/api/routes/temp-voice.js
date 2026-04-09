const { Router } = require('express');
const { ChannelType } = require('discord.js');
const models = require('../../db/models');
const tempVoiceController = require('../../controller/temp-voice');
const { verifyToken, requireGroupAdmin } = require('../middlewares/auth');
const auditLog = require('../../controller/audit-log');

const route = Router();

module.exports = (app) => {
  app.use('/temp-voice', route);

  // 생성기 목록 조회
  route.get('/:groupId/generators', verifyToken, requireGroupAdmin, async (req, res) => {
    const { groupId } = req.params;
    const generators = await models.temp_voice_generator.findAll({
      where: { groupId: Number(groupId) },
    });

    const client = req.app.discordClient;
    const result = generators.map((g) => {
      const channel = client.channels.cache.get(g.channelId);
      return {
        id: g.id,
        channelId: g.channelId,
        channelName: channel ? channel.name : null,
        categoryId: g.categoryId,
        defaultName: g.defaultName,
        defaultUserLimit: g.defaultUserLimit,
      };
    });

    return res.json(result);
  });

  // 생성기 설정 (등록/업데이트)
  route.post('/:groupId/generators', verifyToken, requireGroupAdmin, async (req, res) => {
    const { groupId } = req.params;
    const { channelId, defaultName, defaultUserLimit } = req.body;

    if (!channelId) {
      return res.status(400).json({ result: 'channelId는 필수입니다.' });
    }

    const group = await models.group.findByPk(Number(groupId));
    if (!group || !group.discordGuildId) {
      return res.status(404).json({ result: '���룹을 찾을 수 없습니다.' });
    }

    const client = req.app.discordClient;
    const channel = client.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      return res.status(400).json({ result: '유효한 음��� 채널이 아닙니다.' });
    }

    const existing = await tempVoiceController.findGenerator(channelId);
    if (existing) {
      await tempVoiceController.updateGenerator(channelId, {
        defaultName: defaultName || '{username}의 채널',
        defaultUserLimit: defaultUserLimit || 0,
        categoryId: channel.parentId,
      });
      auditLog.log({
        groupId: Number(groupId),
        actorDiscordId: req.user.discordId,
        actorName: req.user.name,
        action: 'generator.update',
        details: {
          channelId,
          channelName: channel.name,
          defaultName: defaultName || '{username}의 채널',
          defaultUserLimit: defaultUserLimit || 0,
        },
        source: 'web',
      });
      return res.json({ result: '생성기 설정이 업데이트되었습니다.' });
    }

    await tempVoiceController.createGenerator({
      groupId: Number(groupId),
      guildId: group.discordGuildId,
      channelId,
      categoryId: channel.parentId,
      defaultName: defaultName || '{username}의 채널',
      defaultUserLimit: defaultUserLimit || 0,
    });

    auditLog.log({
      groupId: Number(groupId),
      actorDiscordId: req.user.discordId,
      actorName: req.user.name,
      action: 'generator.create',
      details: {
        channelId,
        channelName: channel.name,
        defaultName: defaultName || '{username}의 채널',
        defaultUserLimit: defaultUserLimit || 0,
      },
      source: 'web',
    });

    return res.status(201).json({ result: '생성기가 등록되었습니다.' });
  });

  // 생성기 해제
  route.delete('/:groupId/generators/:channelId', verifyToken, requireGroupAdmin, async (req, res) => {
    const { channelId } = req.params;

    const existing = await tempVoiceController.findGenerator(channelId);
    if (!existing) {
      return res.status(404).json({ result: '해당 생성기��� ��을 수 없습니다.' });
    }

    await tempVoiceController.deleteGenerator(channelId);
    auditLog.log({
      groupId: Number(req.params.groupId),
      actorDiscordId: req.user.discordId,
      actorName: req.user.name,
      action: 'generator.delete',
      details: { channelId },
      source: 'web',
    });
    return res.json({ result: '생성기가 해제되었습니다.' });
  });

  // 음성 채널 목록 조회 (생성기 설정 UI용)
  route.get('/:groupId/voice-channels', verifyToken, requireGroupAdmin, async (req, res) => {
    const { groupId } = req.params;

    const group = await models.group.findByPk(Number(groupId));
    if (!group || !group.discordGuildId) {
      return res.status(404).json({ result: '그룹을 찾을 수 없습���다.' });
    }

    const client = req.app.discordClient;
    const guild = client.guilds.cache.get(group.discordGuildId);
    if (!guild) {
      return res.status(404).json({ result: '디스코드 서버를 찾을 수 없습니다.' });
    }

    const voiceChannels = guild.channels.cache
      .filter((ch) => ch.type === ChannelType.GuildVoice)
      .sort((a, b) => {
        const aPPos = a.parent ? a.parent.position : -1;
        const bPPos = b.parent ? b.parent.position : -1;
        if (aPPos !== bPPos) return aPPos - bPPos;
        return a.position - b.position;
      })
      .map((ch) => ({
        id: ch.id,
        name: ch.name,
        categoryId: ch.parentId,
        categoryName: ch.parent ? ch.parent.name : null,
      }));

    return res.json(voiceChannels);
  });
};
