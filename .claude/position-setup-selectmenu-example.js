// 방법 B: 설정 버튼 → 메시지 업데이트 (SelectMenu) 방식
// 장점: 오타 없음, 명확한 선택, 이모지로 시각화
// 단점: 클릭 2~3회 필요 (버튼 → SelectMenu 선택 → 돌아가기)

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder
} = require('discord.js');

// 1. 초기 UI: 전체 유저 목록 + 각 유저별 설정 버튼
function buildUserListUI(pickedUsers, positionData, timeKey) {
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🎯 포지션 설정')
    .setDescription(buildStatusText(pickedUsers, positionData))
    .addFields(
      {
        name: '🔵 1팀',
        value: getTeamPlayers(pickedUsers, positionData, '1팀') || '없음',
        inline: true
      },
      {
        name: '🔴 2팀',
        value: getTeamPlayers(pickedUsers, positionData, '2팀') || '없음',
        inline: true
      },
      {
        name: '🎲 랜덤',
        value: getTeamPlayers(pickedUsers, positionData, '랜덤') || '없음',
        inline: true
      }
    )
    .setFooter({ text: '유저를 선택하여 팀과 포지션을 설정하세요' });

  const rows = [];
  let currentRow = new ActionRowBuilder();

  pickedUsers.forEach((nickname, index) => {
    const displayName = nickname.length > 12 ? nickname.substring(0, 10) + '..' : nickname;

    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`userSelect|${timeKey}|${nickname}`)
        .setLabel(`${index + 1}. ${displayName}`)
        .setStyle(ButtonStyle.Secondary)
    );

    if ((index + 1) % 5 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  });

  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  // 완료 버튼
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`posConfirm|${timeKey}`)
        .setLabel('✅ 설정 완료')
        .setStyle(ButtonStyle.Success)
    )
  );

  return { embeds: [embed], components: rows };
}

// 2. 개별 유저 설정 UI (버튼 클릭 시)
function buildUserConfigUI(nickname, currentData, timeKey) {
  const teamEmoji = { '랜덤': '🎲', '1팀': '🐶', '2팀': '🐱' }[currentData.team];
  const posEmoji = {
    '랜덤': '🎲', '탑': '🛡️', '정글': '🌲',
    '미드': '🔥', '원딜': '🏹', '서폿': '💚'
  }[currentData.position];

  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle(`⚙️ ${nickname} 설정`)
    .setDescription(
      `**현재 설정:**\n` +
      `팀: ${teamEmoji} ${currentData.team}\n` +
      `포지션: ${posEmoji} ${currentData.position}\n\n` +
      `아래 메뉴에서 팀과 포지션을 선택하세요.`
    );

  // 팀 선택 SelectMenu
  const teamSelect = new StringSelectMenuBuilder()
    .setCustomId(`teamSelect|${timeKey}|${nickname}`)
    .setPlaceholder('팀 선택')
    .addOptions([
      {
        label: '랜덤',
        value: '랜덤',
        emoji: '🎲',
        description: '자동으로 팀 배정',
        default: currentData.team === '랜덤'
      },
      {
        label: '1팀',
        value: '1팀',
        emoji: '🔵',
        description: 'Blue Side',
        default: currentData.team === '1팀'
      },
      {
        label: '2팀',
        value: '2팀',
        emoji: '🔴',
        description: 'Red Side',
        default: currentData.team === '2팀'
      }
    ]);

  // 포지션 선택 SelectMenu
  const positionSelect = new StringSelectMenuBuilder()
    .setCustomId(`posSelect|${timeKey}|${nickname}`)
    .setPlaceholder('포지션 선택')
    .addOptions([
      {
        label: '랜덤',
        value: '랜덤',
        emoji: '🎲',
        description: '자동으로 포지션 배정',
        default: currentData.position === '랜덤'
      },
      {
        label: '탑',
        value: '탑',
        emoji: '🛡️',
        description: 'Top Lane',
        default: currentData.position === '탑'
      },
      {
        label: '정글',
        value: '정글',
        emoji: '🌲',
        description: 'Jungle',
        default: currentData.position === '정글'
      },
      {
        label: '미드',
        value: '미드',
        emoji: '🔥',
        description: 'Mid Lane',
        default: currentData.position === '미드'
      },
      {
        label: '원딜',
        value: '원딜',
        emoji: '🏹',
        description: 'ADC',
        default: currentData.position === '원딜'
      },
      {
        label: '서폿',
        value: '서폿',
        emoji: '💚',
        description: 'Support',
        default: currentData.position === '서폿'
      }
    ]);

  // 돌아가기 버튼
  const backButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`backToList|${timeKey}`)
      .setLabel('← 목록으로 돌아가기')
      .setStyle(ButtonStyle.Primary)
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(teamSelect),
      new ActionRowBuilder().addComponents(positionSelect),
      backButton
    ]
  };
}

// 3. 핸들러들
async function handleUserSelectButton(interaction, data, nickname, timeKey) {
  const currentData = data.positionData[nickname];
  const ui = buildUserConfigUI(nickname, currentData, timeKey);
  await interaction.update(ui);
}

async function handleTeamSelect(interaction, data, nickname, timeKey) {
  const selectedTeam = interaction.values[0];
  data.positionData[nickname].team = selectedTeam;

  // UI 갱신 (현재 설정 화면 유지)
  const ui = buildUserConfigUI(nickname, data.positionData[nickname], timeKey);
  await interaction.update(ui);
}

async function handlePositionSelect(interaction, data, nickname, timeKey) {
  const selectedPosition = interaction.values[0];
  data.positionData[nickname].position = selectedPosition;

  // UI 갱신 (현재 설정 화면 유지)
  const ui = buildUserConfigUI(nickname, data.positionData[nickname], timeKey);
  await interaction.update(ui);
}

async function handleBackToList(interaction, data, timeKey) {
  const ui = buildUserListUI(data.pickedUsers, data.positionData, timeKey);
  await interaction.update(ui);
}

// 헬퍼 함수들
function buildStatusText(pickedUsers, positionData) {
  let text = '';
  pickedUsers.forEach((nickname, index) => {
    const data = positionData[nickname];
    const teamEmoji = { '랜덤': '🎲', '1팀': '🔵', '2팀': '🔴' }[data.team];
    const posEmoji = {
      '랜덤': '🎲', '탑': '🛡️', '정글': '🌲',
      '미드': '🔥', '원딜': '🏹', '서폿': '💚'
    }[data.position];
    text += `${teamEmoji}${posEmoji} ${index + 1}. ${nickname}\n`;
  });
  return text;
}

function getTeamPlayers(pickedUsers, positionData, team) {
  const players = pickedUsers
    .filter(nickname => positionData[nickname].team === team)
    .map(nickname => {
      const pos = positionData[nickname].position;
      const posEmoji = {
        '랜덤': '🎲', '탑': '🛡️', '정글': '🌲',
        '미드': '🔥', '원딜': '🏹', '서폿': '💚'
      }[pos];
      return `${posEmoji} ${pos} - ${nickname}`;
    });
  return players.length > 0 ? players.join('\n') : null;
}

module.exports = {
  buildUserListUI,
  buildUserConfigUI,
  handleUserSelectButton,
  handleTeamSelect,
  handlePositionSelect,
  handleBackToList
};
