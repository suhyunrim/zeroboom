const tempVoiceController = require('../controller/temp-voice');

exports.run = async (groupName, interaction) => {
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel) {
    return '❌ 음성 채널에 접속해 있어야 합니다.';
  }

  const isOwner = await tempVoiceController.isOwner(voiceChannel.id, interaction.user.id);
  if (!isOwner) {
    return '❌ 이 채널의 소유자만 인원 제한을 변경할 수 있습니다.';
  }

  const limit = interaction.options.getInteger('인원');
  await voiceChannel.setUserLimit(limit);
  return `✅ 인원 제한이 **${limit || '없음'}**(으)로 변경되었습니다.`;
};

exports.conf = {
  enabled: true,
  requireGroup: false,
  aliases: ['채널인원'],
  args: [['integer', '인원', '인원 제한 (0=무제한)', true]],
};

exports.help = {
  name: 'temp-voice-limit',
  description: '임시 음성 채널 인원 제한을 변경합니다.',
  usage: '채널인원 숫자',
};
