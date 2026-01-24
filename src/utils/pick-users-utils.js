/**
 * 인원뽑기 관련 공통 유틸리티
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');

// 공통 상수
const PICK_COUNT = 10;
const MAX_TOGGLE_MEMBERS = 24;

// 포지션 이모지 매핑
const POSITION_EMOJI = {
  '상관X': '🎲',
  '탑': '⚔️',
  '정글': '🐺',
  '미드': '✨',
  '원딜': '🏹',
  '서폿': '💖'
};

// 팀 이모지 매핑
const TEAM_EMOJI = {
  '랜덤팀': '🎲',
  '1팀': '🔵',
  '2팀': '🔴'
};

// 포지션 정렬 순서
const POSITION_ORDER = {
  '탑': 1,
  '정글': 2,
  '미드': 3,
  '원딜': 4,
  '서폿': 5,
  '상관X': 6
};

// 닉네임 파싱용 특수문자
const SPECIAL_CHARS = ['(', ')', '-', '_', '[', ']', '{', '}', '|', '\\', ':', '"', "'", '<', '>', ',', '.', '/'];

/**
 * 특수문자 위치 찾기 (앞쪽)
 */
function findSpecialCharBeforeIndex(str, index) {
  const substring = str.slice(0, index);
  for (let i = substring.length - 1; i >= 0; i--) {
    if (SPECIAL_CHARS.includes(substring[i])) {
      return i;
    }
  }
  return 0;
}

/**
 * 특수문자 위치 찾기 (뒤쪽)
 */
function findSpecialCharAfterIndex(str, index) {
  const substring = str.slice(index);
  for (let i = 0; i < substring.length; i++) {
    if (SPECIAL_CHARS.includes(substring[i])) {
      return index + i;
    }
  }
  return str.length;
}

/**
 * Discord 닉네임에서 LoL 닉네임 추출
 */
const getLOLNickname = (nickname) => {
  const sharpIndex = nickname.indexOf('#');
  if (sharpIndex === -1) return nickname.trim();
  const specialCharIndex1 = findSpecialCharBeforeIndex(nickname, sharpIndex);
  const specialCharIndex2 = findSpecialCharAfterIndex(nickname, sharpIndex);
  return nickname.substring(specialCharIndex1 + 1, specialCharIndex2).trim();
};

/**
 * Discord 멤버에서 정보 추출
 */
const getMemberInfo = (member) => {
  const nickname = member.nickname != null ? member.nickname : member.user.username;
  const lolNickname = getLOLNickname(nickname);
  return {
    discordId: member.id,
    nickname,
    lolNickname,
  };
};

/**
 * 토글 UI 버튼 생성
 */
const buildToggleButtons = (memberList, excludedNames, timeKey) => {
  const rows = [];
  let currentRow = new ActionRowBuilder();
  let buttonCount = 0;

  for (const member of memberList) {
    const isExcluded = excludedNames.includes(member.lolNickname);
    const emoji = isExcluded ? '❌' : '✅';
    const style = isExcluded ? ButtonStyle.Secondary : ButtonStyle.Success;

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

  if (buttonCount % 5 !== 0) {
    rows.push(currentRow);
  }

  const startRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pickToggle|${timeKey}|start`)
      .setLabel('🎲 뽑기 시작')
      .setStyle(ButtonStyle.Primary),
  );
  rows.push(startRow);

  return rows;
};

/**
 * 결과 버튼 생성 (복사/매칭생성/포지션)
 */
const buildResultButtons = (time) => {
  return new ActionRowBuilder()
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
};

/**
 * 토글 메시지 생성
 */
const buildToggleMessage = (channelName, memberCount, includedCount) => {
  return `**${channelName}**에 **${memberCount}명**이 있습니다.\n` +
    `제외할 멤버를 클릭하세요. (현재 ${includedCount}명 참가)\n` +
    `✅ = 참가 / ❌ = 제외`;
};

/**
 * 토글 버튼 처리
 */
const handleToggle = async (interaction, data, memberName, buildToggleButtonsFn = buildToggleButtons) => {
  const excludedNames = [...data.excludedNames];
  const memberIndex = excludedNames.indexOf(memberName);

  if (memberIndex === -1) {
    excludedNames.push(memberName);
  } else {
    excludedNames.splice(memberIndex, 1);
  }

  const includedCount = data.memberList.length - excludedNames.length;
  const timeKey = interaction.customId.split('|')[1];
  const rows = buildToggleButtonsFn(data.memberList, excludedNames, timeKey);

  return {
    content: buildToggleMessage(data.channelName, data.memberList.length, includedCount),
    components: rows,
    excludedNames,
  };
};

/**
 * 최종 뽑기 실행
 */
const executePick = async (interaction, data) => {
  const includedMembers = data.memberList.filter((m) => !data.excludedNames.includes(m.lolNickname));

  if (includedMembers.length < PICK_COUNT) {
    return {
      content: `참가 인원이 ${includedMembers.length}명입니다. 최소 ${PICK_COUNT}명이 필요합니다.`,
      ephemeral: true,
    };
  }

  const shuffled = [...includedMembers].sort(() => Math.random() - 0.5);
  const pickedMembers = shuffled.slice(0, PICK_COUNT);
  const unpickedMembers = shuffled.slice(PICK_COUNT);

  const pickedNicknames = pickedMembers.map((m) => m.lolNickname);
  // discordId와 lolNickname을 매핑
  const pickedMembersData = pickedMembers.map((m) => ({
    discordId: m.discordId,
    lolNickname: m.lolNickname,
  }));
  const commandStr = pickedMembers.map((m, index) => `유저${index + 1}:${m.lolNickname}`);
  const unpickedNicknames = unpickedMembers.map((m) => m.lolNickname);

  let message = `**${data.channelName}**에서 **${includedMembers.length}명** 중 **${PICK_COUNT}명**을 뽑습니다!

   \`🎉 축하합니다! 🎉\`
   :robot:: /매칭생성 ${commandStr.join(' ')}`;

  if (unpickedNicknames.length > 0) {
    message += `
    ---------------------------------------
    ❌: ${unpickedNicknames.join(',')}`;
  }

  const time = Date.now();
  const row = buildResultButtons(time);

  return {
    content: message,
    components: [row],
    pickedUsers: pickedNicknames,
    pickedMembersData,
    commandStr: `/매칭생성 ${commandStr.join(' ')}`,
  };
};

/**
 * 포지션 설정 UI 생성
 */
const buildPositionUI = (pickedUsers, positionData, timeKey) => {
  const team1 = [];
  const team2 = [];
  const random = [];

  pickedUsers.forEach((nickname) => {
    const data = positionData[nickname];
    const displayName = nickname.length > 12 ? nickname.substring(0, 12) : nickname;

    let line;
    if (data.position === '상관X') {
      line = `\`${displayName}\``;
    } else {
      const posEmoji = POSITION_EMOJI[data.position];
      line = `\`${posEmoji} ${data.position}: ${displayName}\``;
    }

    const entry = { line, position: data.position };

    if (data.team === '1팀') team1.push(entry);
    else if (data.team === '2팀') team2.push(entry);
    else random.push(entry);
  });

  const sortByPosition = (a, b) => POSITION_ORDER[a.position] - POSITION_ORDER[b.position];
  team1.sort(sortByPosition);
  team2.sort(sortByPosition);
  random.sort(sortByPosition);

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🎯 포지션 설정')
    .setDescription('유저 버튼을 클릭하여 팀/포지션을 설정하세요');

  if (team1.length > 0) {
    embed.addFields({
      name: '🔵 1팀',
      value: team1.map(e => e.line).join('\n') || '\u200B',
      inline: true
    });
  }

  if (team2.length > 0) {
    embed.addFields({
      name: '🔴 2팀',
      value: team2.map(e => e.line).join('\n') || '\u200B',
      inline: true
    });
  }

  if (random.length > 0) {
    embed.addFields({
      name: '🎲 랜덤팀',
      value: random.map(e => e.line).join('\n') || '\u200B',
      inline: false
    });
  }

  const rows = [];

  // 유저 버튼 (한 줄에 5개씩)
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

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`posConfirm|${timeKey}`)
      .setLabel('🎮 매칭 생성')
      .setStyle(ButtonStyle.Success)
  );
  rows.push(confirmRow);

  return {
    embeds: [embed],
    components: rows,
  };
};

/**
 * 개별 유저 설정 UI (ephemeral)
 */
const buildUserEditUI = (nickname, positionData, timeKey) => {
  const data = positionData[nickname];

  const teamEmoji = TEAM_EMOJI[data.team];
  const posEmoji = POSITION_EMOJI[data.position];

  const content = `**⚙️ ${nickname} 설정**\n\n현재: ${teamEmoji} ${data.team} / ${posEmoji} ${data.position}`;

  const teamSelect = new StringSelectMenuBuilder()
    .setCustomId(`posSelectTeam|${timeKey}|${nickname}`)
    .setPlaceholder(data.team ? `현재: ${data.team}` : '팀 선택')
    .addOptions([
      { label: '랜덤팀', value: '랜덤팀', emoji: '🎲', description: '자동으로 팀 배정' },
      { label: '1팀', value: '1팀', emoji: '🔵', description: 'Blue Side' },
      { label: '2팀', value: '2팀', emoji: '🔴', description: 'Red Side' }
    ]);

  const positionSelect = new StringSelectMenuBuilder()
    .setCustomId(`posSelectPos|${timeKey}|${nickname}`)
    .setPlaceholder(data.position ? `현재: ${data.position}` : '포지션 선택')
    .addOptions([
      { label: '상관X', value: '상관X', emoji: '🎲', description: '자동으로 포지션 배정' },
      { label: '탑', value: '탑', emoji: '⚔️', description: 'Top Lane' },
      { label: '정글', value: '정글', emoji: '🐺', description: 'Jungle' },
      { label: '미드', value: '미드', emoji: '✨', description: 'Mid Lane' },
      { label: '원딜', value: '원딜', emoji: '🏹', description: 'ADC' },
      { label: '서폿', value: '서폿', emoji: '💖', description: 'Support' }
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

/**
 * 공통 reactButton 처리 (copy, match, position)
 */
const createReactButtonHandler = (matchMake, models, buildPositionUIFn = buildPositionUI) => {
  return async (interaction, data) => {
    const customId = interaction.customId;
    const action = customId.split('|')[2];

    if (action === 'copy') {
      return {
        content: `\`\`\`${data.commandStr}\`\`\`\n위 명령어를 복사해서 사용하세요!`,
        ephemeral: true,
      };
    }

    if (action === 'match') {
      const group = await models.group.findOne({
        where: { discordGuildId: interaction.guildId },
      });

      if (!group) {
        return { content: '그룹 정보를 찾을 수 없습니다.', ephemeral: true };
      }

      // discordId로 실제 소환사 이름을 조회하여 fakeOptions 생성
      const fakeOptions = [];
      for (let index = 0; index < data.pickedUsers.length; index++) {
        const parsedName = data.pickedUsers[index];
        const memberData = data.pickedMembersData ? data.pickedMembersData[index] : null;
        let actualName = parsedName;

        // discordId가 있으면 DB에서 실제 소환사 이름 조회
        if (memberData && memberData.discordId) {
          const userData = await models.user.findOne({
            where: { groupId: group.id, discordId: memberData.discordId },
          });
          if (userData) {
            const summonerData = await models.summoner.findOne({
              where: { puuid: userData.puuid },
            });
            if (summonerData) {
              actualName = summonerData.name;
            }
          }
        }

        fakeOptions.push({
          name: `유저${index + 1}`,
          value: actualName,
        });
      }

      const fakeInteraction = {
        ...interaction,
        options: {
          data: fakeOptions,
        },
      };

      const result = await matchMake.run(group.groupName, fakeInteraction);
      return result;
    }

    if (action === 'position') {
      const timeKey = customId.split('|')[1];
      const positionData = {};
      data.pickedUsers.forEach((nickname) => {
        positionData[nickname] = { team: '랜덤팀', position: '상관X' };
      });

      const ui = buildPositionUIFn(data.pickedUsers, positionData, timeKey);
      return {
        ...ui,
        content: '',
        isPositionMode: true,
        pickedUsers: data.pickedUsers,
        pickedMembersData: data.pickedMembersData,
        positionData,
      };
    }
  };
};

module.exports = {
  // 상수
  PICK_COUNT,
  MAX_TOGGLE_MEMBERS,
  POSITION_EMOJI,
  TEAM_EMOJI,
  POSITION_ORDER,

  // 유틸 함수
  getLOLNickname,
  getMemberInfo,

  // UI 빌더
  buildToggleButtons,
  buildResultButtons,
  buildToggleMessage,
  buildPositionUI,
  buildUserEditUI,

  // 핸들러
  handleToggle,
  executePick,
  createReactButtonHandler,
};
