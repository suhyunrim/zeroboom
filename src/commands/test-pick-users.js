const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const matchMake = require('./match-make');
const models = require('../db/models');
const pickUsers = require('./pick-users');

const pickCount = 10;
const testMemberCount = 15;
const maxToggleMembers = 24;

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

// 테스트 모드: 그룹에서 랜덤 15명 가져오기
const getTestMembers = async (groupName) => {
  const group = await models.group.findOne({
    where: { groupName },
  });

  if (!group) {
    return [];
  }

  // 그룹에 속한 유저들 조회
  const users = await models.user.findAll({
    where: { groupId: group.id },
  });

  if (users.length === 0) {
    return [];
  }

  // puuid 목록으로 소환사 정보 조회
  const puuids = users.map((u) => u.puuid);
  const summoners = await models.summoner.findAll({
    where: { puuid: puuids },
  });

  // 소환사 정보를 멤버 형식으로 변환
  const memberList = summoners.map((s) => ({
    id: s.puuid,
    nickname: s.name,
    lolNickname: s.name,
  }));

  // 랜덤 섞기 후 15명 선택
  const shuffled = memberList.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, testMemberCount);
};

exports.run = async (groupName, interaction) => {
  // 테스트 모드: 그룹에서 랜덤 15명
  const memberList = await getTestMembers(groupName);
  const channelName = '테스트 모드';

  if (memberList.length < pickCount) {
    return `그룹에 등록된 유저가 ${memberList.length}명입니다. 최소 ${pickCount}명이 필요합니다.`;
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
    // 포지션 설정 UI로 전환 (pick-users.js의 함수 사용)
    const timeKey = customId.split('|')[1];
    const positionData = {};
    data.pickedUsers.forEach((nickname) => {
      positionData[nickname] = { team: '랜덤팀', position: '상관X' };
    });

    const ui = pickUsers.buildPositionUI(data.pickedUsers, positionData, timeKey);
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
  aliases: ['테스트_인원뽑기'],
  args: [],
};

exports.help = {
  name: 'test-pick-users',
  description: '그룹에서 랜덤 15명으로 테스트 뽑기',
  usage: 'test-pick-users',
};
