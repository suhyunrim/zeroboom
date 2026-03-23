const tempVoiceController = require('../controller/temp-voice');

exports.run = async (groupName, interaction) => {
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel) {
    return '❌ 음성 채널에 접속해 있어야 합니다.';
  }

  const isOwner = await tempVoiceController.isOwner(voiceChannel.id, interaction.user.id);
  if (!isOwner) {
    return '❌ 이 채널의 소유자만 이름을 변경할 수 있습니다.';
  }

  const newName = interaction.options.getString('이름');
  await voiceChannel.setName(newName);
  return `✅ 채널 이름이 **${newName}**(으)로 변경되었습니다.`;
};

exports.conf = {
  enabled: true,
  requireGroup: false,
  aliases: ['채널이름'],
  args: [['string', '이름', '변경할 채널 이름', true]],
};

exports.help = {
  name: 'temp-voice-name',
  description: '임시 음성 채널 이름을 변경합니다.',
  usage: '채널이름 새이름',
};
