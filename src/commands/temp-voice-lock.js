const { PermissionFlagsBits } = require('discord.js');
const tempVoiceController = require('../controller/temp-voice');

exports.run = async (groupName, interaction) => {
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel) {
    return '❌ 음성 채널에 접속해 있어야 합니다.';
  }

  const isOwner = await tempVoiceController.isOwner(voiceChannel.id, interaction.user.id);
  if (!isOwner) {
    return '❌ 이 채널의 소유자만 잠금/해제할 수 있습니다.';
  }

  const everyoneRole = interaction.guild.roles.everyone;
  const currentPerms = voiceChannel.permissionOverwrites.cache.get(everyoneRole.id);
  const isLocked = currentPerms && currentPerms.deny.has(PermissionFlagsBits.Connect);

  if (isLocked) {
    await voiceChannel.permissionOverwrites.edit(everyoneRole, { Connect: null });
    return '🔓 채널이 **해제**되었습니다. 누구나 참여할 수 있습니다.';
  }

  await voiceChannel.permissionOverwrites.edit(everyoneRole, { Connect: false });
  return '🔒 채널이 **잠금**되었습니다. 새로운 참여가 차단됩니다.';
};

exports.conf = {
  enabled: true,
  requireGroup: false,
  aliases: ['채널잠금'],
  args: [],
};

exports.help = {
  name: 'temp-voice-lock',
  description: '임시 음성 채널을 잠금/해제합니다.',
  usage: '채널잠금',
};
