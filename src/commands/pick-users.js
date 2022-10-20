const { registerUser } = require('../services/user');

exports.run = async (groupName, interaction) => {
  if (!interaction.member.voice.channelId) {
    return '입장해있는 음성채널이 없습니다.';
  }

  const members = interaction.member.voice.channel.members;
  const pickedUsers = members.random(10);
  const unpickedUsers = members.filter(
    (member) => !pickedUsers.includes(member),
  );

  const pickedNicknames = pickedUsers.map((member, index) => {
    const startIndex = member.nickname.indexOf('(');
    return `유저${index + 1}:${member.nickname.substring(
      startIndex + 1,
      member.nickname.length - 1,
    )}`;
  });

  const unpickedNicknames = unpickedUsers.map((member) => {
    const startIndex = member.nickname.indexOf('(');
    return member.nickname.substring(
      startIndex + 1,
      member.nickname.length - 1,
    );
  });

  let message = `**${interaction.member.voice.channel.name}** 채널에서 **${
    members.size
  }명** 중 **${10}명**을 뽑습니다!

   \`🎉 축하합니다! 🎉\`
   :white_check_mark:: ${pickedNicknames.join(', ')}
   :robot:: /매칭생성 ${pickedNicknames.join(' ')}`;

  if (unpickedNicknames.length > 0) {
    message += `
    ---------------------------------------
    ❌: ${unpickedNicknames.join(',')}`;
  }

  return message;
};

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['인원뽑기', 'ru'],
  args: [['number', '인원수', '인원 수를 입력해주세요. (기본값 : 10)', false]],
};

exports.help = {
  name: 'register-user',
  description: '입장해있는 채널에서 랜덤수 만큼 인원 뽑기',
  usage: 'register-user summonerName@tier',
};
