const tempVoiceController = require('../controller/temp-voice');

exports.run = async (groupName, interaction) => {
  if (!interaction.memberPermissions.has('ManageChannels')) {
    return '❌ 이 명령어는 채널 관리 권한이 필요합니다.';
  }

  const channel = interaction.options.getChannel('채널');
  const existing = await tempVoiceController.findGenerator(channel.id);
  if (!existing) {
    return '❌ 해당 채널은 생성기로 등록되어 있지 않습니다.';
  }

  await tempVoiceController.deleteGenerator(channel.id);
  return `✅ **${channel.name}** 채널의 임시 음성 채널 생성기 설정이 해제되었습니다.`;
};

exports.conf = {
  enabled: true,
  requireGroup: false,
  aliases: ['임시채널해제'],
  args: [['channel', '채널', '해제할 생성기 채널', true]],
};

exports.help = {
  name: 'temp-voice-remove',
  description: '임시 음성 채널 생성기를 해제합니다.',
  usage: '임시채널해제 #채널',
};
