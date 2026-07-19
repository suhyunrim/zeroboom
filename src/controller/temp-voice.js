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
  const team1Name = `${prefix}🐶팀`;
  const team2Name = `${prefix}🐱팀`;

  // 같은 카테고리에 이미 존재하는 팀 채널 재사용
  const findExisting = (name) => {
    return guild.channels.cache.find(
      (ch) => ch.parentId === categoryId && ch.type === ChannelType.GuildVoice && ch.name === name,
    );
  };

  const team1Channel = findExisting(team1Name) || await guild.channels.create({
    name: team1Name,
    type: ChannelType.GuildVoice,
    parent: categoryId,
  });
  const team2Channel = findExisting(team2Name) || await guild.channels.create({
    name: team2Name,
    type: ChannelType.GuildVoice,
    parent: categoryId,
  });

  // temp_voice_channels에 등록 (이미 등록된 경우 건너뜀)
  const ensureTempRecord = async (channelId) => {
    const existing = await models.temp_voice_channel.findOne({ where: { channelId } });
    if (!existing) {
      await models.temp_voice_channel.create({ channelId, guildId: guild.id, ownerDiscordId, generatorId: 0 });
    }
  };
  await ensureTempRecord(team1Channel.id);
  await ensureTempRecord(team2Channel.id);

  // 멤버 이동.
  // 스킵 사유를 반환한다 — 예전에는 모든 실패 경로가 조용히 return이라
  // "누가 왜 안 옮겨졌는지"를 사후에 알 방법이 없었다.
  const moveMember = async (discordId, targetChannel) => {
    if (!discordId) return { discordId, status: 'no_discord_id' };

    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) return { discordId, status: 'not_in_guild' };

    const name = member.displayName;
    if (!member.voice || !member.voice.channelId) return { discordId, name, status: 'not_in_voice' };

    // 같은 카테고리에 있는 멤버만 이동 (다른 카테고리에 있는 사람은 납치하지 않음)
    const currentChannel = guild.channels.cache.get(member.voice.channelId);
    if (currentChannel && currentChannel.parentId !== categoryId) {
      return { discordId, name, status: 'other_category', detail: currentChannel.name };
    }

    try {
      await member.voice.setChannel(targetChannel);
      return { discordId, name, status: 'moved' };
    } catch (e) {
      return { discordId, name, status: 'move_failed', detail: e.message };
    }
  };

  const results = await Promise.all([
    ...team1DiscordIds.map((id) => moveMember(id, team1Channel)),
    ...team2DiscordIds.map((id) => moveMember(id, team2Channel)),
  ]);

  // 이동 후 빈 채널 즉시 정리
  const cleanup = async (channel) => {
    if (channel.members.size === 0) {
      await models.temp_voice_channel.destroy({ where: { channelId: channel.id } });
      await channel.delete().catch(() => {});
    }
  };
  await Promise.all([cleanup(team1Channel), cleanup(team2Channel)]);

  const moved = results.filter((r) => r.status === 'moved');
  const skipped = results.filter((r) => r.status !== 'moved');
  logger.info(
    `내전 팀 채널 생성: ${team1Channel.id}, ${team2Channel.id} — 이동 ${moved.length}/${results.length}` +
      (skipped.length
        ? ` / 스킵: ${skipped.map((r) => `${r.name || r.discordId}(${r.status}${r.detail ? `: ${r.detail}` : ''})`).join(', ')}`
        : ''),
  );
  return { team1Channel, team2Channel, results };
};

// 스킵 사유를 사용자가 읽을 수 있는 문구로. 본인이 직접 원인을 알 수 있어야 문의가 줄어든다.
const SKIP_REASON_TEXT = {
  no_discord_id: '디스코드 계정 미연동',
  not_in_guild: '서버에서 찾을 수 없음',
  not_in_voice: '음성 채널 미접속',
  other_category: '다른 카테고리 음성 채널에 있음',
  move_failed: '이동 실패(권한 확인 필요)',
};

module.exports.summarizeMoveResults = (results) => {
  const moved = results.filter((r) => r.status === 'moved');
  const skipped = results.filter((r) => r.status !== 'moved');
  if (!skipped.length) return `🔊 팀 보이스 채널로 이동했습니다! (${moved.length}명)`;

  const byReason = {};
  skipped.forEach((r) => { (byReason[r.status] ||= []).push(r.name || r.discordId); });
  const lines = Object.entries(byReason).map(
    ([status, names]) => `• ${SKIP_REASON_TEXT[status] || status}: ${names.join(', ')}`,
  );
  return `🔊 팀 보이스 채널로 이동했습니다! (${moved.length}/${results.length}명)\n이동하지 못한 인원:\n${lines.join('\n')}`;
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
