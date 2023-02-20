const moment = require('moment');

const pickCount = 10;
const fixedMember = {};

exports.run = async (groupName, interaction) => {
  if (!interaction.member.voice.channelId) {
    return '입장해있는 음성채널이 없습니다.';
  }

  if (!fixedMember[groupName]) {
    fixedMember[groupName] = {};
  }

  let pickedUsers = [];
  const members = interaction.member.voice.channel.members;
  // 12시간 안에 한번 짤린 유저가 있으면 무조건 포함시킴 (by zeroboom)
  for (let pair of members) {
    const member = pair[1];
    const tagetUserMoment = fixedMember[groupName][member.id];
    if (tagetUserMoment) {
      const diff = moment().utc().diff(tagetUserMoment, 'hours');
      if (diff < 12) {
        pickedUsers.push(member);
        delete fixedMember[groupName][member.id];
      }
    }
  }

  const fixedNicknames = pickedUsers.map((member) => {
    const nickname = member.nickname != null ? member.nickname : member.user.username;
    const startIndex = nickname.indexOf('(');
    return nickname.substring(startIndex + 1, nickname.length - 1);
  });

  pickedUsers = pickedUsers.concat(members.filter(member => !pickedUsers.includes(member)).random(pickCount - pickedUsers.length));

  const unpickedUsers = members.filter((member) => !pickedUsers.includes(member)).map((member) => member);
  for (let unpickedUser of unpickedUsers) {
    fixedMember[groupName][unpickedUser.id] = moment().utc();
  }

  const pickedNicknames = pickedUsers.map((member, index) => {
    const nickname = member.nickname != null ? member.nickname : member.user.username;
    const startIndex = nickname.indexOf('(');
    return nickname.substring(startIndex + 1, nickname.length - 1);
  });

  const commandStr = pickedUsers.map((member, index) => {
    const nickname = member.nickname != null ? member.nickname : member.user.username;
    const startIndex = nickname.indexOf('(');
    return `유저${index + 1}:${nickname.substring(startIndex + 1, nickname.length - 1)}`;
  });

  const unpickedNicknames = unpickedUsers.map((member) => {
    const nickname = member.nickname != null ? member.nickname : member.user.username;
    const startIndex = nickname.indexOf('(');
    return nickname.substring(startIndex + 1, nickname.length - 1);
  });

  let message = `**${interaction.member.voice.channel.name}** 채널에서 **${members.size}명** 중 **${pickCount}명**을 뽑습니다!

   \`🎉 축하합니다! 🎉\`
   :white_check_mark:: ${pickedNicknames.map(name => fixedNicknames.includes(name) ? `${name}(확정)` : name).join(', ')}
   :robot:: /매칭생성 ${commandStr.join(' ')}`;

  if (unpickedNicknames.length > 0) {
    message += `
    ---------------------------------------
    ❌: ${unpickedNicknames.join(',')} (다음 뽑기 때 확정으로 뽑히게 됩니다)`;
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
