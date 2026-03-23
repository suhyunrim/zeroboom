const { Op } = require('sequelize');
const { ChannelType } = require('discord.js');
const models = require('../db/models');
const { logger } = require('../loaders/logger');

// 생성기 채널 조회
module.exports.findGenerator = async (channelId) => {
  return models.temp_voice_generator.findOne({ where: { channelId } });
};

// 임시 채널 레코드 생성
module.exports.createTempChannel = async ({ channelId, guildId, ownerDiscordId, generatorId }) => {
  return models.temp_voice_channel.create({ channelId, guildId, ownerDiscordId, generatorId });
};

// 임시 채널 레코드 조회
module.exports.findTempChannel = async (channelId) => {
  return models.temp_voice_channel.findOne({ where: { channelId } });
};

// 임시 채널 레코드 삭제
module.exports.deleteTempChannel = async (channelId) => {
  return models.temp_voice_channel.destroy({ where: { channelId } });
};

// 생성기 등록
module.exports.createGenerator = async ({ groupId, guildId, channelId, categoryId, defaultName, defaultUserLimit }) => {
  return models.temp_voice_generator.create({
    groupId,
    guildId,
    channelId,
    categoryId,
    defaultName: defaultName || '{username}의 채널',
    defaultUserLimit: defaultUserLimit || 0,
  });
};

// 특정 생성기의 활성 임시 채널 수 조회
module.exports.countActiveChannels = async (generatorId) => {
  return models.temp_voice_channel.count({ where: { generatorId } });
};

// 생성기 설정 업데이트
module.exports.updateGenerator = async (channelId, updates) => {
  return models.temp_voice_generator.update(updates, { where: { channelId } });
};

// 생성기 해제
module.exports.deleteGenerator = async (channelId) => {
  return models.temp_voice_generator.destroy({ where: { channelId } });
};

// 임시 채널 소유자 확인
module.exports.isOwner = async (channelId, discordUserId) => {
  const record = await models.temp_voice_channel.findOne({ where: { channelId } });
  return record && record.ownerDiscordId === discordUserId;
};

// 소유권 이전
module.exports.transferOwnership = async (channelId, newOwnerDiscordId) => {
  return models.temp_voice_channel.update({ ownerDiscordId: newOwnerDiscordId }, { where: { channelId } });
};

// 매칭 확정 시 팀 음성 채널 생성 및 멤버 이동
module.exports.createMatchTeamChannels = async ({
  guild,
  categoryId,
  ownerDiscordId,
  team1DiscordIds,
  team2DiscordIds,
  channelName,
}) => {
  const prefix = channelName ? `${channelName} :: ` : '';
  const team1Channel = await guild.channels.create({
    name: `${prefix}🐶팀`,
    type: ChannelType.GuildVoice,
    parent: categoryId,
  });
  const team2Channel = await guild.channels.create({
    name: `${prefix}🐱팀`,
    type: ChannelType.GuildVoice,
    parent: categoryId,
  });

  // temp_voice_channels에 등록 (퇴장 시 자동 삭제)
  await models.temp_voice_channel.create({
    channelId: team1Channel.id,
    guildId: guild.id,
    ownerDiscordId,
    generatorId: 0,
  });
  await models.temp_voice_channel.create({
    channelId: team2Channel.id,
    guildId: guild.id,
    ownerDiscordId,
    generatorId: 0,
  });

  // 멤버 이동
  const moveMember = (discordId, targetChannel) => {
    const member = guild.members.cache.get(discordId);
    if (member && member.voice && member.voice.channelId) {
      return member.voice.setChannel(targetChannel).catch(() => {});
    }
    return Promise.resolve();
  };

  await Promise.all([
    ...team1DiscordIds.filter(Boolean).map((id) => moveMember(id, team1Channel)),
    ...team2DiscordIds.filter(Boolean).map((id) => moveMember(id, team2Channel)),
  ]);

  // 이동 후 빈 채널 즉시 정리
  const cleanup = async (channel) => {
    if (channel.members.size === 0) {
      await models.temp_voice_channel.destroy({ where: { channelId: channel.id } });
      await channel.delete().catch(() => {});
    }
  };
  await Promise.all([cleanup(team1Channel), cleanup(team2Channel)]);

  logger.info(`내전 팀 채널 생성: ${team1Channel.id}, ${team2Channel.id}`);
  return { team1Channel, team2Channel };
};

// 봇 재시작 시 정합성 처리: DB에 있지만 실제로 없는 채널 정리
module.exports.cleanupOrphanedChannels = async (client) => {
  const records = await models.temp_voice_channel.findAll();
  const orphanIds = records
    .filter((record) => {
      const guild = client.guilds.cache.get(record.guildId);
      const channel = guild && guild.channels.cache.get(record.channelId);
      if (!channel) return true;
      if (channel.members.size === 0) {
        channel.delete().catch(() => {});
        return true;
      }
      return false;
    })
    .map((record) => record.id);

  if (orphanIds.length > 0) {
    await models.temp_voice_channel.destroy({ where: { id: { [Op.in]: orphanIds } } });
    logger.info(`정합성 처리: 고아 임시 채널 ${orphanIds.length}개 정리`);
  }
};
