const { ChannelType } = require('discord.js');
const models = require('../db/models');
const tempVoiceController = require('../controller/temp-voice');
const auditLog = require('../controller/audit-log');

exports.run = async (groupName, interaction) => {
  if (!interaction.memberPermissions.has('ManageChannels')) {
    return '❌ 이 명령어는 채널 관리 권한이 필요합니다.';
  }

  const channel = interaction.options.getChannel('채널');
  if (channel.type !== ChannelType.GuildVoice) {
    return '❌ 음성 채널을 선택해주세요.';
  }

  const group = await models.group.findOne({ where: { discordGuildId: interaction.guildId } });
  if (!group) {
    return '❌ 먼저 방 등록을 해주세요.';
  }

  const defaultName = interaction.options.getString('이름패턴') || '{username}의 채널';
  const defaultUserLimit = interaction.options.getInteger('인원제한') || 0;

  const existing = await tempVoiceController.findGenerator(channel.id);
  if (existing) {
    await tempVoiceController.updateGenerator(channel.id, {
      defaultName,
      defaultUserLimit,
      categoryId: channel.parentId,
    });
    auditLog.log({
      groupId: group.id,
      actorDiscordId: interaction.user.id,
      actorName: interaction.member.nickname,
      action: 'generator.update',
      details: { channelId: channel.id, channelName: channel.name, defaultName, defaultUserLimit },
      source: 'discord',
    });
    return (
      `✅ **${channel.name}** 생성기 설정이 업데이트되었습니다.\n` +
      `- 이름 패턴: \`${defaultName}\`\n` +
      `- 인원 제한: ${defaultUserLimit || '없음'}`
    );
  }

  await tempVoiceController.createGenerator({
    groupId: group.id,
    guildId: interaction.guildId,
    channelId: channel.id,
    categoryId: channel.parentId,
    defaultName,
    defaultUserLimit,
  });

  auditLog.log({
    groupId: group.id,
    actorDiscordId: interaction.user.id,
    actorName: interaction.member.nickname,
    action: 'generator.create',
    details: { channelId: channel.id, channelName: channel.name, defaultName, defaultUserLimit },
    source: 'discord',
  });

  return (
    `✅ **${channel.name}** 채널이 임시 음성 채널 생성기로 설정되었습니다.\n` +
    `- 이름 패턴: \`${defaultName}\`\n` +
    `- 인원 제한: ${defaultUserLimit || '없음'}`
  );
};

exports.conf = {
  enabled: true,
  requireGroup: false,
  aliases: ['임시채널설정'],
  args: [
    ['channel', '채널', '생성기로 사용할 음성 채널', true],
    ['string', '이름패턴', '임시 채널 이름 패턴 (기본: {username}의 채널)', false],
    ['integer', '인원제한', '기본 인원 제한 (0=무제한)', false],
  ],
};

exports.help = {
  name: 'temp-voice-setup',
  description: '임시 음성 채널 생성기를 설정합니다.',
  usage: '임시채널설정 #채널 [이름패턴] [인원제한]',
};
