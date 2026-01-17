const moment = require('moment');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const matchMake = require('./match-make');
const pickUsers = require('./pick-users');

const pickCount = 10;
const fixedMember = {};

const specialChars = ['(', ')', '-', '_', '[', ']', '{', '}', '|', '\\', ':', '"', "'", '<', '>', ',', '.', '/'];

function findSpecialCharBeforeIndex(str, index) {
  const substring = str.slice(0, index);
  for (let i = substring.length - 1; i >= 0; i--) {
    if (specialChars.includes(substring[i])) {
      return i;
    }
  }

  return 0;
}

function findSpecialCharAfterIndex(str, index) {
  const substring = str.slice(index);

  for (let i = 0; i < substring.length; i++) {
    if (specialChars.includes(substring[i])) {
      return index + i;
    }
  }

  return str.length;
}

const getLOLNickname = (nickname) => {
  const sharpIndex = nickname.indexOf('#');
  const specialCharIndex1 = findSpecialCharBeforeIndex(nickname, sharpIndex);
  const specialCharIndex2 = findSpecialCharAfterIndex(nickname, sharpIndex);
  return nickname.substring(specialCharIndex1 + 1, specialCharIndex2);
};

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
    members.filter((member) => !pickedUsers.includes(member)).random(pickCount - pickedUsers.length),
  );

  const unpickedUsers = members.filter((member) => !pickedUsers.includes(member)).map((member) => member);
  for (let unpickedUser of unpickedUsers) {
    fixedMember[groupName][unpickedUser.id] = moment().utc();
  }

  const pickedNicknames = pickedUsers.map((member) => {
    const nickname = member.nickname != null ? member.nickname : member.user.username;
    return getLOLNickname(nickname);
  });

  const commandStr = pickedUsers.map((member, index) => {
    const nickname = member.nickname != null ? member.nickname : member.user.username;
    return `유저${index + 1}:${getLOLNickname(nickname)}`;
  });

  const unpickedNicknames = unpickedUsers.map((member) => {
    const nickname = member.nickname != null ? member.nickname : member.user.username;
    return getLOLNickname(nickname);
  });

  let message = `**${interaction.member.voice.channel.name}** 채널에서 **${
    members.size
  }명** 중 **${pickCount}명**을 뽑습니다!

   \`🎉 축하합니다! 🎉\`
   :robot:: /매칭생성 ${commandStr.join(' ')}`;

  if (unpickedNicknames.length > 0) {
    message += `
    ---------------------------------------
    ❌: ${unpickedNicknames.join(',')} (다음 뽑기 때 확정으로 뽑히게 됩니다)`;
  }

  const time = Date.now();
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`pickUsers|${time}|copy`)
        .setLabel('📋 명령어 복사')
        .setStyle(ButtonStyle.Secondary),
    )
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`pickUsers|${time}|match`)
        .setLabel('🎮 바로 매칭생성')
        .setStyle(ButtonStyle.Primary),
    );

  return {
    content: message,
    components: [row],
    fetchReply: true,
    pickedUsers: pickedNicknames,
    commandStr: `/매칭생성 ${commandStr.join(' ')}`,
  };
};

exports.reactButton = async (interaction, data) => {
  const customId = interaction.customId;
  const action = customId.split('|')[2];

  if (action === 'copy') {
    return {
      content: `\`\`\`${data.commandStr}\`\`\`\n위 명령어를 복사해서 사용하세요!`,
      ephemeral: true,
    };
  }

  if (action === 'match') {
    const fakeOptions = data.pickedUsers.map((name, index) => ({
      name: `유저${index + 1}`,
      value: name,
    }));

    const fakeInteraction = {
      ...interaction,
      options: {
        data: fakeOptions,
      },
    };

    const group = await require('../db/models').group.findOne({
      where: { discordGuildId: interaction.guildId },
    });

    if (!group) {
      return { content: '그룹 정보를 찾을 수 없습니다.', ephemeral: true };
    }

    const result = await matchMake.run(group.groupName, fakeInteraction);
    return result;
  }
};

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
