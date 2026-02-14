const moment = require('moment');
const matchMake = require('./match-make');
const models = require('../db/models');
const utils = require('../utils/pick-users-utils');

const {
  PICK_COUNT,
  getLOLNickname,
  buildResultButtons,
  buildPositionUI,
  createReactButtonHandler,
} = utils;

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
      const diff = moment()
        .utc()
        .diff(tagetUserMoment, 'hours');
      if (diff < 12) {
        pickedUsers.push(member);
        delete fixedMember[groupName][member.id];
      }
    }
  }

  pickedUsers = pickedUsers.concat(
    members.filter((member) => !pickedUsers.includes(member)).random(PICK_COUNT - pickedUsers.length),
  );

  const unpickedUsers = members.filter((member) => !pickedUsers.includes(member)).map((member) => member);
  for (let unpickedUser of unpickedUsers) {
    fixedMember[groupName][unpickedUser.id] = moment().utc();
  }

  const pickedNicknames = pickedUsers.map((member) => {
    const nickname = member.nickname != null ? member.nickname : member.user.username;
    return getLOLNickname(nickname);
  });

  // discordId와 lolNickname을 매핑
  const pickedMembersData = pickedUsers.map((member) => {
    const nickname = member.nickname != null ? member.nickname : member.user.username;
    return {
      discordId: member.id,
      lolNickname: getLOLNickname(nickname),
    };
  });

  const commandStr = pickedUsers.map((member, index) => {
    const nickname = member.nickname != null ? member.nickname : member.user.username;
    return `유저${index + 1}:${getLOLNickname(nickname)}`;
  });

  const unpickedNicknames = unpickedUsers.map((member) => {
    const nickname = member.nickname != null ? member.nickname : member.user.username;
    return getLOLNickname(nickname);
  });

  let message = `🎲 **${interaction.member.voice.channel.name}**에서 **${members.size}명** 중 **${PICK_COUNT}명**을 뽑습니다!

🎉 **축하합니다!** 🎉

✅ **통과** : ${pickedNicknames.join(', ')}`;

  if (unpickedNicknames.length > 0) {
    message += `\n\n❌ **탈락** : ${unpickedNicknames.join(', ')}\n> 다음 뽑기 때 확정으로 포함됩니다.`;
  }

  const time = Date.now();
  const row = buildResultButtons(time);

  return {
    content: message,
    components: [row],
    fetchReply: true,
    pickedUsers: pickedNicknames,
    pickedMembersData,
    commandStr: `/매칭생성 ${commandStr.join(' ')}`,
  };
};

exports.reactButton = createReactButtonHandler(matchMake, models, buildPositionUI);

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['랜덤인원뽑기'],
  args: [],
};

exports.help = {
  name: 'random-pick-users',
  description: '입장해있는 채널에서 랜덤으로 10명 인원 뽑기',
  usage: 'random-pick-users',
};
