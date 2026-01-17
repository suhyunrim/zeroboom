const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const matchMake = require('./match-make');
const models = require('../db/models');

const pickCount = 10;
const maxToggleMembers = 24; // 버튼 최대 개수 (5x5=25, 마지막에 뽑기 버튼)

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
  if (sharpIndex === -1) return nickname;
  const specialCharIndex1 = findSpecialCharBeforeIndex(nickname, sharpIndex);
  const specialCharIndex2 = findSpecialCharAfterIndex(nickname, sharpIndex);
  return nickname.substring(specialCharIndex1 + 1, specialCharIndex2);
};

// 멤버 정보를 가져오는 헬퍼 함수
const getMemberInfo = (member) => {
  const nickname = member.nickname != null ? member.nickname : member.user.username;
  const lolNickname = getLOLNickname(nickname);
  return {
    id: member.id,
    nickname,
    lolNickname,
  };
};

// 토글 UI 버튼 생성 함수 (lolNickname을 키로 사용)
const buildToggleButtons = (memberList, excludedNames, timeKey) => {
  const rows = [];
  let currentRow = new ActionRowBuilder();
  let buttonCount = 0;

  for (const member of memberList) {
    const isExcluded = excludedNames.includes(member.lolNickname);
    const emoji = isExcluded ? '❌' : '✅';
    const style = isExcluded ? ButtonStyle.Secondary : ButtonStyle.Success;

    // 닉네임이 너무 길면 자르기 (버튼 라벨 제한)
    const displayName = member.lolNickname.length > 15
      ? member.lolNickname.substring(0, 12) + '...'
      : member.lolNickname;

    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`pickToggle|${timeKey}|${member.lolNickname}`)
        .setLabel(`${emoji} ${displayName}`)
        .setStyle(style),
    );
    buttonCount++;

    if (buttonCount % 5 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  }

  // 남은 버튼이 있으면 추가
  if (buttonCount % 5 !== 0) {
    rows.push(currentRow);
  }

  // 뽑기 시작 버튼 추가 (마지막 줄)
  const startRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pickToggle|${timeKey}|start`)
      .setLabel('🎲 뽑기 시작')
      .setStyle(ButtonStyle.Primary),
  );
  rows.push(startRow);

  return rows;
};

exports.run = async (groupName, interaction) => {
  // 일반 모드: 음성채널 멤버
  if (!interaction.member.voice.channelId) {
    return '입장해있는 음성채널이 없습니다.';
  }

  const members = interaction.member.voice.channel.members;
  const channelName = interaction.member.voice.channel.name;

  if (members.size < pickCount) {
    return `채널에 ${members.size}명이 있습니다. 최소 ${pickCount}명이 필요합니다.`;
  }

  if (members.size > maxToggleMembers) {
    return `채널에 ${members.size}명이 있습니다. 토글 UI는 최대 ${maxToggleMembers}명까지 지원합니다.`;
  }

  const memberList = [];
  for (const [, member] of members) {
    memberList.push(getMemberInfo(member));
  }

  const time = Date.now();
  const rows = buildToggleButtons(memberList, [], time);
  const includedCount = memberList.length;

  return {
    content: `**${channelName}**에 **${memberList.length}명**이 있습니다.\n` +
      `제외할 멤버를 클릭하세요. (현재 ${includedCount}명 참가)\n` +
      `✅ = 참가 / ❌ = 제외`,
    components: rows,
    fetchReply: true,
    // 토글 모드 데이터
    isToggleMode: true,
    memberList,
    excludedNames: [],
    groupName,
    channelName,
  };
};

// 토글 버튼 처리 함수 (lolNickname 기반)
exports.handleToggle = async (interaction, data, memberName) => {
  // 제외 목록 토글
  const excludedNames = [...data.excludedNames];
  const memberIndex = excludedNames.indexOf(memberName);

  if (memberIndex === -1) {
    excludedNames.push(memberName);
  } else {
    excludedNames.splice(memberIndex, 1);
  }

  const includedCount = data.memberList.length - excludedNames.length;
  const timeKey = interaction.customId.split('|')[1];

  const rows = buildToggleButtons(data.memberList, excludedNames, timeKey);

  return {
    content: `**${data.channelName}**에 **${data.memberList.length}명**이 있습니다.\n` +
      `제외할 멤버를 클릭하세요. (현재 ${includedCount}명 참가)\n` +
      `✅ = 참가 / ❌ = 제외`,
    components: rows,
    excludedNames, // 업데이트된 제외 목록 반환
  };
};

// 최종 뽑기 실행 함수 (lolNickname 기반)
exports.executePick = async (interaction, data) => {
  const includedMembers = data.memberList.filter((m) => !data.excludedNames.includes(m.lolNickname));

  if (includedMembers.length < pickCount) {
    return {
      content: `참가 인원이 ${includedMembers.length}명입니다. 최소 ${pickCount}명이 필요합니다.`,
      ephemeral: true,
    };
  }

  // 랜덤으로 10명 선택
  const shuffled = [...includedMembers].sort(() => Math.random() - 0.5);
  const pickedMembers = shuffled.slice(0, pickCount);
  const unpickedMembers = shuffled.slice(pickCount);

  const pickedNicknames = pickedMembers.map((m) => m.lolNickname);
  const commandStr = pickedMembers.map((m, index) => `유저${index + 1}:${m.lolNickname}`);
  const unpickedNicknames = unpickedMembers.map((m) => m.lolNickname);

  let message = `**${data.channelName}**에서 **${includedMembers.length}명** 중 **${pickCount}명**을 뽑습니다!

   \`🎉 축하합니다! 🎉\`
   :robot:: /매칭생성 ${commandStr.join(' ')}`;

  if (unpickedNicknames.length > 0) {
    message += `
    ---------------------------------------
    ❌: ${unpickedNicknames.join(',')}`;
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
    )
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`pickUsers|${time}|position`)
        .setLabel('🎯 포지션 정하기')
        .setStyle(ButtonStyle.Success),
    );

  return {
    content: message,
    components: [row],
    pickedUsers: pickedNicknames,
    commandStr: `/매칭생성 ${commandStr.join(' ')}`,
  };
};

// 포지션 설정 메인 UI - 유저 버튼 리스트
exports.buildPositionUI = (pickedUsers, positionData, timeKey) => {
  // 전체 상태 요약 텍스트
  let summaryText = '**🎯 포지션 설정**\n\n';
  const team1 = [];
  const team2 = [];
  const random = [];

  pickedUsers.forEach((nickname, idx) => {
    const data = positionData[nickname];
    const teamEmoji = data.team === '랜덤팀' ? '🎲' : data.team === '1팀' ? '🔵' : '🔴';
    const posEmoji = {
      '상관X': '🎲', '탑': '🛡️', '정글': '🌲',
      '미드': '🔥', '원딜': '🏹', '서폿': '💚'
    }[data.position];
    const line = `${teamEmoji}${posEmoji} ${idx + 1}. ${nickname} - ${data.team} / ${data.position}`;

    if (data.team === '1팀') team1.push(line);
    else if (data.team === '2팀') team2.push(line);
    else random.push(line);
  });

  if (team1.length > 0) summaryText += `**🔵 1팀:**\n${team1.join('\n')}\n\n`;
  if (team2.length > 0) summaryText += `**🔴 2팀:**\n${team2.join('\n')}\n\n`;
  if (random.length > 0) summaryText += `**🎲 랜덤팀:**\n${random.join('\n')}\n\n`;

  summaryText += '━━━━━━━━━━━━━━━━━━━━\n**유저 버튼을 클릭**하여 팀/포지션을 설정하세요';

  const rows = [];

  // 10명 유저 버튼 (2줄, 각 줄당 5개)
  for (let start = 0; start < pickedUsers.length; start += 5) {
    const slice = pickedUsers.slice(start, start + 5);
    const row = new ActionRowBuilder().addComponents(
      slice.map((nickname, idx) => {
        const globalIdx = start + idx;
        const displayName = nickname.length > 12 ? nickname.substring(0, 10) + '..' : nickname;
        return new ButtonBuilder()
          .setCustomId(`posEditUser|${timeKey}|${nickname}`)
          .setLabel(`${globalIdx + 1}. ${displayName}`)
          .setStyle(ButtonStyle.Secondary);
      })
    );
    rows.push(row);
  }

  // 매칭 생성 버튼
  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`posConfirm|${timeKey}`)
      .setLabel('🎮 매칭 생성')
      .setStyle(ButtonStyle.Success)
  );

  rows.push(confirmRow);

  return {
    content: summaryText,
    components: rows,
  };
};

// 개별 유저 설정 UI (ephemeral)
exports.buildUserEditUI = (nickname, positionData, timeKey) => {
  const data = positionData[nickname];

  const teamEmoji = data.team === '랜덤팀' ? '🎲' : data.team === '1팀' ? '🔵' : '🔴';
  const posEmoji = {
    '상관X': '🎲', '탑': '🛡️', '정글': '🌲',
    '미드': '🔥', '원딜': '🏹', '서폿': '💚'
  }[data.position];

  const content = `**⚙️ ${nickname} 설정**\n\n현재: ${teamEmoji} ${data.team} / ${posEmoji} ${data.position}`;

  // 팀 선택 SelectMenu
  const teamSelect = new StringSelectMenuBuilder()
    .setCustomId(`posSelectTeam|${timeKey}|${nickname}`)
    .setPlaceholder(data.team ? `현재: ${data.team}` : '팀 선택')
    .addOptions([
      { label: '랜덤팀', value: '랜덤팀', emoji: '🎲', description: '자동으로 팀 배정' },
      { label: '1팀', value: '1팀', emoji: '🔵', description: 'Blue Side' },
      { label: '2팀', value: '2팀', emoji: '🔴', description: 'Red Side' }
    ]);

  // 포지션 선택 SelectMenu
  const positionSelect = new StringSelectMenuBuilder()
    .setCustomId(`posSelectPos|${timeKey}|${nickname}`)
    .setPlaceholder(data.position ? `현재: ${data.position}` : '포지션 선택')
    .addOptions([
      { label: '상관X', value: '상관X', emoji: '🎲', description: '자동으로 포지션 배정' },
      { label: '탑', value: '탑', emoji: '🛡️', description: 'Top Lane' },
      { label: '정글', value: '정글', emoji: '🌲', description: 'Jungle' },
      { label: '미드', value: '미드', emoji: '🔥', description: 'Mid Lane' },
      { label: '원딜', value: '원딜', emoji: '🏹', description: 'ADC' },
      { label: '서폿', value: '서폿', emoji: '💚', description: 'Support' }
    ]);

  return {
    content,
    components: [
      new ActionRowBuilder().addComponents(teamSelect),
      new ActionRowBuilder().addComponents(positionSelect)
    ],
    ephemeral: true,
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

    const group = await models.group.findOne({
      where: { discordGuildId: interaction.guildId },
    });

    if (!group) {
      return { content: '그룹 정보를 찾을 수 없습니다.', ephemeral: true };
    }

    const result = await matchMake.run(group.groupName, fakeInteraction);
    return result;
  }

  if (action === 'position') {
    // 포지션 설정 UI로 전환
    const timeKey = customId.split('|')[1];
    const positionData = {};
    data.pickedUsers.forEach((nickname) => {
      positionData[nickname] = { team: '랜덤팀', position: '상관X' };
    });

    const ui = exports.buildPositionUI(data.pickedUsers, positionData, timeKey);
    return {
      ...ui,
      isPositionMode: true,
      pickedUsers: data.pickedUsers,
      positionData,
    };
  }
};

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['인원뽑기'],
  args: [],
};

exports.help = {
  name: 'pick-users',
  description: '제외할 인원을 선택 후 10명 뽑기',
  usage: 'pick-users',
};
