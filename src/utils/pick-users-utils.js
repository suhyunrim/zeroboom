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
 * 결과 버튼 생성 (매칭생성/포지션/포지션매칭)
 */
const buildResultButtons = (time) => {
  return new ActionRowBuilder()
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
    )
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`pickUsers|${time}|positionMatch`)
        .setLabel('🧪 포지션 매칭생성')
        .setStyle(ButtonStyle.Secondary),
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
          discordId: memberData?.discordId || null,
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

    if (action === 'positionMatch') {
      return handlePositionMatch(interaction, data, models, matchMake);
    }
  };
};

/**
 * 포지션 매칭 생성 핸들러
 */
const handlePositionMatch = async (interaction, data, models, matchMake) => {
  const { optimizePositionsForMatches, POSITIONS, POSITION_KR } = require('../match-maker/position-optimizer');
  const { getTierName, getTierStep, getTierPoint } = require('./tierUtils');

  const group = await models.group.findOne({
    where: { discordGuildId: interaction.guildId },
  });

  if (!group) {
    return { content: '그룹 정보를 찾을 수 없습니다.', ephemeral: true };
  }

  // 1. 유저 정보 수집 및 playerDataMap 생성
  const playerDataMap = {};
  const fakeOptions = [];

  for (let i = 0; i < data.pickedUsers.length; i++) {
    const parsedName = data.pickedUsers[i];
    const memberData = data.pickedMembersData ? data.pickedMembersData[i] : null;

    let summonerData = null;
    let userData = null;

    // discordId로 먼저 조회
    if (memberData && memberData.discordId) {
      userData = await models.user.findOne({
        where: { groupId: group.id, discordId: memberData.discordId },
      });
      if (userData) {
        summonerData = await models.summoner.findOne({
          where: { puuid: userData.puuid },
        });
      }
    }

    // discordId로 못 찾으면 이름으로 조회
    if (!summonerData) {
      summonerData = await models.summoner.findOne({
        where: { name: parsedName },
      });
      if (summonerData) {
        userData = await models.user.findOne({
          where: { groupId: group.id, puuid: summonerData.puuid },
        });
      }
    }

    if (!summonerData || !userData) {
      return { content: `유저 정보를 찾을 수 없습니다: ${parsedName}`, ephemeral: true };
    }

    const actualName = summonerData.name;
    const rating = userData.defaultRating + userData.additionalRating;

    // 포지션 변환 (UTILITY -> SUPPORT)
    const normalizePosition = (pos) => {
      if (!pos) return null;
      if (pos === 'UTILITY') return 'SUPPORT';
      return pos;
    };

    playerDataMap[actualName] = {
      puuid: summonerData.puuid,
      name: actualName,
      rating,
      mainPos: normalizePosition(summonerData.mainPosition),
      subPos: normalizePosition(summonerData.subPosition),
      mainPositionRate: summonerData.mainPositionRate || 0,
      subPositionRate: summonerData.subPositionRate || 0,
    };

    fakeOptions.push({
      name: `유저${i + 1}`,
      value: actualName,
      discordId: memberData?.discordId || null,
    });
  }

  // 2. 기존 매칭 생성 (상위 100개)
  const fakeInteraction = {
    ...interaction,
    options: { data: fakeOptions },
  };

  const matchResult = await matchMake.run(group.groupName, fakeInteraction);
  if (typeof matchResult === 'string' || !matchResult.match) {
    return { content: matchResult || '매칭 생성에 실패했습니다.', ephemeral: true };
  }

  // 3. 포지션 최적화 (상위 30개 중 포지션 점수 비슷한 2개 선택)
  const optimizedMatches = optimizePositionsForMatches(matchResult.match, playerDataMap, {
    topN: 30,
    resultCount: 2,
  });

  if (!optimizedMatches || optimizedMatches.length === 0) {
    return { content: '포지션 매칭 생성에 실패했습니다.', ephemeral: true };
  }

  // 4. 결과 포맷팅
  const positionAbbr = { TOP: 'TOP', JUNGLE: 'JG', MIDDLE: 'MID', BOTTOM: 'AD', SUPPORT: 'SUP' };
  const typeEmoji = { MAIN: '🟢', SUB: '🟡', OFF: '🔴' };

  const formatTeamField = (teamResult, teamEmoji, teamName, winRate) => {
    let totalRating = 0;
    const lines = teamResult.assignments.map(a => {
      const playerData = playerDataMap[a.playerName];
      const rating = playerData?.rating || 500;
      totalRating += rating;
      const tierName = getTierName(rating);
      const tierStep = getTierStep(rating);
      const isHighTier = tierName === 'MASTER' || tierName === 'GRANDMASTER' || tierName === 'CHALLENGER';
      const tierAbbr = tierName === 'GRANDMASTER' ? 'GM' : tierName.charAt(0);
      const tierDisplay = isHighTier
        ? `[${tierAbbr} ${getTierPoint(rating)}LP]`
        : `[${tierName.charAt(0)}${tierStep}]`;

      return `${typeEmoji[a.assignmentType]}\`${tierDisplay}[${positionAbbr[a.position]}]${a.playerName}\``;
    });

    const winRateStr = `${(winRate * 100).toFixed(1)}%`;

    // 평균 티어 계산
    const avgRating = totalRating / 5;
    const avgTierName = getTierName(avgRating);
    const avgTierStep = getTierStep(avgRating);
    const avgIsHighTier = avgTierName === 'MASTER' || avgTierName === 'GRANDMASTER' || avgTierName === 'CHALLENGER';
    const avgTierAbbr = avgTierName === 'GRANDMASTER' ? 'GM' : avgTierName.charAt(0);
    const avgTierDisplay = avgIsHighTier
      ? `[평균 ${avgTierAbbr} ${getTierPoint(avgRating)}LP]`
      : `[평균 ${avgTierName.charAt(0)}${avgTierStep}]`;

    return {
      name: `${teamEmoji} ${teamName} (${winRateStr}) ${avgTierDisplay}`,
      value: lines.join('\n'),
      inline: true,
    };
  };

  // 포지션별 유저 정보 생성
  const positionUsers = {
    TOP: [],
    JUNGLE: [],
    MIDDLE: [],
    BOTTOM: [],
    SUPPORT: [],
  };

  // 메인/서브 포지션별로 유저 수집
  Object.values(playerDataMap).forEach(p => {
    if (p.mainPos && positionUsers[p.mainPos]) {
      positionUsers[p.mainPos].push({ name: p.name, rate: p.mainPositionRate || 0 });
    }
    if (p.subPos && positionUsers[p.subPos]) {
      positionUsers[p.subPos].push({ name: p.name, rate: p.subPositionRate || 0 });
    }
  });

  // 각 포지션별로 비율 높은 순 정렬
  Object.keys(positionUsers).forEach(pos => {
    positionUsers[pos].sort((a, b) => b.rate - a.rate);
  });

  const fields = [];

  // mainPositionRate가 0인 유저 수집 (데이터 없음)
  const noDataUsers = Object.values(playerDataMap)
    .filter(p => !p.mainPositionRate || p.mainPositionRate === 0)
    .map(p => p.name);

  // 포지션별 유저 표시
  const posOrderList = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'SUPPORT'];
  const positionLines = [];
  posOrderList.forEach(pos => {
    const abbr = positionAbbr[pos];
    const users = positionUsers[pos].filter(u => u.rate >= 20);
    if (users.length === 0) {
      positionLines.push(`**${abbr}**: -`);
    } else {
      positionLines.push(`**${abbr}**`);
      users.forEach((u, idx) => {
        positionLines.push(`${idx + 1}. ${u.rate.toFixed(0)}% - ${u.name}`);
      });
    }
  });

  // 데이터 없는 유저 표시
  if (noDataUsers.length > 0) {
    positionLines.push(`※ **데이터 없음**`);
    noDataUsers.forEach((name, idx) => {
      positionLines.push(`${idx + 1}. ${name}`);
    });
  }

  fields.push({
    name: '📋 유저 포지션 (최근 솔랭 100판 기준 포지션 비율)',
    value: positionLines.join('\n'),
    inline: false,
  });

  fields.push({ name: '\u200B', value: '\u200B' });
  fields.push({
    name: '📌 구분 (포지션은 협의하고 진행해주세요.)',
    value: '🟢 메인 / 🟡 서브 / 🔴 오프',
    inline: false,
  });

  // 경우의 수
  optimizedMatches.forEach((match, idx) => {
    fields.push({ name: '\u200B', value: '\u200B' });
    const po = match.positionOptimization;
    fields.push({
      name: `**Plan ${idx + 1}**`,
      value: '',
      inline: false,
    });
    fields.push(formatTeamField(po.teamA, '🐶', '1팀', match.team1WinRate));
    fields.push(formatTeamField(po.teamB, '🐱', '2팀', 1 - match.team1WinRate));
  });

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🧪 [BETA] 포지션 매칭생성 결과')
    .addFields(fields);

  // 버튼 생성
  const time = Date.now();
  const rows = [];
  const buttonRow = new ActionRowBuilder();
  optimizedMatches.forEach((match, idx) => {
    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`posMatch|${time}|${idx}`)
        .setLabel(`${idx + 1}번`)
        .setStyle(ButtonStyle.Primary),
    );
  });
  rows.push(buttonRow);

  return {
    embeds: [embed],
    components: rows,
    isPositionMatchMode: true,
    positionMatches: optimizedMatches,
    playerDataMap,
    groupId: group.id,
    time,
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
  handlePositionMatch,
};
