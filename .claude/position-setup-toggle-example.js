// 방법 C: 각 유저별 [팀] [포지션] 토글 버튼 직접 제공
// 장점: 가장 빠른 설정 (클릭 1~2회), 별도 화면 전환 없음
// 단점: 버튼이 많아 복잡해 보일 수 있음, 페이지네이션 필요

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

// 1. 토글 버튼 UI (5명씩 페이지 분할)
function buildToggleUI(pickedUsers, positionData, timeKey, page = 0) {
  const usersPerPage = 5;
  const totalPages = Math.ceil(pickedUsers.length / usersPerPage);
  const startIdx = page * usersPerPage;
  const endIdx = Math.min(startIdx + usersPerPage, pickedUsers.length);
  const pageUsers = pickedUsers.slice(startIdx, endIdx);

  // Embed로 전체 상태 표시
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🎯 포지션 설정')
    .setDescription(buildFullStatusText(pickedUsers, positionData))
    .addFields(
      {
        name: '📋 현재 페이지',
        value: `${page + 1}/${totalPages} (${startIdx + 1}~${endIdx}번 유저)`,
        inline: false
      }
    )
    .setFooter({ text: '버튼을 클릭하여 팀/포지션을 순환 변경하세요' });

  const rows = [];

  // 각 유저별 토글 버튼
  pageUsers.forEach((nickname, idx) => {
    const data = positionData[nickname];
    const globalIdx = startIdx + idx;

    const teamEmoji = { '랜덤': '🎲', '1팀': '🔵', '2팀': '🔴' }[data.team];
    const posEmoji = {
      '랜덤': '🎲', '탑': '🛡️', '정글': '🌲',
      '미드': '🔥', '원딜': '🏹', '서폿': '💚'
    }[data.position];

    const displayName = nickname.length > 8 ? nickname.substring(0, 6) + '..' : nickname;

    const row = new ActionRowBuilder().addComponents(
      // 유저명 (비활성화된 버튼으로 라벨 역할)
      new ButtonBuilder()
        .setCustomId(`label|${globalIdx}`)
        .setLabel(`${globalIdx + 1}. ${displayName}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),

      // 팀 토글 버튼
      new ButtonBuilder()
        .setCustomId(`toggleTeam|${timeKey}|${nickname}`)
        .setLabel(`${data.team}`)
        .setEmoji(teamEmoji)
        .setStyle(getTeamButtonStyle(data.team)),

      // 포지션 토글 버튼
      new ButtonBuilder()
        .setCustomId(`togglePos|${timeKey}|${nickname}`)
        .setLabel(`${data.position}`)
        .setEmoji(posEmoji)
        .setStyle(ButtonStyle.Secondary)
    );

    rows.push(row);
  });

  // 페이지네이션 + 완료 버튼
  const navRow = new ActionRowBuilder();

  if (totalPages > 1) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`togglePage|${timeKey}|${page - 1}`)
        .setLabel('◀️ 이전')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),

      new ButtonBuilder()
        .setCustomId(`pageInfo`)
        .setLabel(`${page + 1}/${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),

      new ButtonBuilder()
        .setCustomId(`togglePage|${timeKey}|${page + 1}`)
        .setLabel('다음 ▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );
  }

  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`posConfirm|${timeKey}`)
      .setLabel('✅ 설정 완료')
      .setStyle(ButtonStyle.Success)
  );

  rows.push(navRow);

  return { embeds: [embed], components: rows };
}

// 2. 토글 핸들러
function toggleTeam(currentTeam) {
  const states = ['랜덤', '1팀', '2팀'];
  const currentIdx = states.indexOf(currentTeam);
  return states[(currentIdx + 1) % states.length];
}

function togglePosition(currentPosition) {
  const states = ['랜덤', '탑', '정글', '미드', '원딜', '서폿'];
  const currentIdx = states.indexOf(currentPosition);
  return states[(currentIdx + 1) % states.length];
}

async function handleToggleTeam(interaction, data, nickname, timeKey) {
  const newTeam = toggleTeam(data.positionData[nickname].team);
  data.positionData[nickname].team = newTeam;

  // 현재 페이지 유지
  const currentPage = data.currentPage || 0;
  const ui = buildToggleUI(data.pickedUsers, data.positionData, timeKey, currentPage);

  await interaction.update(ui);
}

async function handleTogglePosition(interaction, data, nickname, timeKey) {
  const newPosition = togglePosition(data.positionData[nickname].position);
  data.positionData[nickname].position = newPosition;

  // 현재 페이지 유지
  const currentPage = data.currentPage || 0;
  const ui = buildToggleUI(data.pickedUsers, data.positionData, timeKey, currentPage);

  await interaction.update(ui);
}

async function handleTogglePage(interaction, data, timeKey, newPage) {
  data.currentPage = newPage;
  const ui = buildToggleUI(data.pickedUsers, data.positionData, timeKey, newPage);
  await interaction.update(ui);
}

// 헬퍼 함수들
function buildFullStatusText(pickedUsers, positionData) {
  const team1 = [];
  const team2 = [];
  const random = [];

  pickedUsers.forEach((nickname, idx) => {
    const data = positionData[nickname];
    const posEmoji = {
      '랜덤': '🎲', '탑': '🛡️', '정글': '🌲',
      '미드': '🔥', '원딜': '🏹', '서폿': '💚'
    }[data.position];

    const line = `${posEmoji} ${data.position} - ${nickname}`;

    if (data.team === '1팀') team1.push(line);
    else if (data.team === '2팀') team2.push(line);
    else random.push(line);
  });

  let text = '';
  if (team1.length > 0) text += `**🔵 1팀:**\n${team1.join('\n')}\n\n`;
  if (team2.length > 0) text += `**🔴 2팀:**\n${team2.join('\n')}\n\n`;
  if (random.length > 0) text += `**🎲 랜덤:**\n${random.join('\n')}`;

  return text || '모든 유저가 랜덤 배정입니다.';
}

function getTeamButtonStyle(team) {
  if (team === '1팀') return ButtonStyle.Primary;   // 파란색
  if (team === '2팀') return ButtonStyle.Danger;    // 빨간색
  return ButtonStyle.Secondary;                      // 회색
}

module.exports = {
  buildToggleUI,
  handleToggleTeam,
  handleTogglePosition,
  handleTogglePage,
  toggleTeam,
  togglePosition
};
