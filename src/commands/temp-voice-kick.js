const tempVoiceController = require('../controller/temp-voice');

exports.run = async (groupName, interaction) => {
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel) {
    return '❌ 음성 채널에 접속해 있어야 합니다.';
  }

  const isOwner = await tempVoiceController.isOwner(voiceChannel.id, interaction.user.id);
  if (!isOwner) {
    return '❌ 이 채널의 소유자만 추방할 수 있습니다.';
  }

  const targetUser = interaction.options.getUser('유저');
  if (targetUser.id === interaction.user.id) {
    return '❌ 자기 자신을 추방할 수 없습니다.';
  }

  const targetMember = voiceChannel.members.get(targetUser.id);
  if (!targetMember) {
    return '❌ 해당 유저가 이 채널에 없습니다.';
  }

  await targetMember.voice.disconnect();
  return `✅ **${targetUser.displayName}**님을 채널에서 추방했습니다.`;
};

exports.conf = {
  enabled: true,
  requireGroup: false,
  aliases: ['채널추방'],
  args: [['user', '유저', '추방할 유저', true]],
};

exports.help = {
  name: 'temp-voice-kick',
  description: '임시 음성 채널에서 유저를 추방합니다.',
  usage: '채널추방 @유저',
};
