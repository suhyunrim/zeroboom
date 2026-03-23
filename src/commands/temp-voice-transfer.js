const tempVoiceController = require('../controller/temp-voice');

exports.run = async (groupName, interaction) => {
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel) {
    return '❌ 음성 채널에 접속해 있어야 합니다.';
  }

  const isOwner = await tempVoiceController.isOwner(voiceChannel.id, interaction.user.id);
  if (!isOwner) {
    return '❌ 이 채널의 소유자만 양도할 수 있습니다.';
  }

  const targetUser = interaction.options.getUser('유저');
  if (targetUser.id === interaction.user.id) {
    return '❌ 자기 자신에게 양도할 수 없습니다.';
  }

  const targetMember = voiceChannel.members.get(targetUser.id);
  if (!targetMember) {
    return '❌ 해당 유저가 이 채널에 없습니다.';
  }

  // 기존 소유자 권한 제거, 새 소유자 권한 부여
  await voiceChannel.permissionOverwrites.delete(interaction.user.id);
  await voiceChannel.permissionOverwrites.edit(targetUser.id, {
    ManageChannels: true,
    MoveMembers: true,
  });
  await tempVoiceController.transferOwnership(voiceChannel.id, targetUser.id);

  return `✅ 채널 소유권이 **${targetUser.displayName}**님에게 양도되었습니다.`;
};

exports.conf = {
  enabled: true,
  requireGroup: false,
  aliases: ['채널양도'],
  args: [['user', '유저', '양도할 유저', true]],
};

exports.help = {
  name: 'temp-voice-transfer',
  description: '임시 음성 채널 소유권을 양도합니다.',
  usage: '채널양도 @유저',
};
