// 방법 A: Modal + TextInput 방식
// 장점: 빠른 입력, 복사/붙여넣기 가능
// 단점: 오타 가능성, 정확한 키워드 입력 필요

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder
} = require('discord.js');

// 1. 초기 UI: 각 유저별 설정 버튼
function buildUserButtons(pickedUsers, positionData, timeKey) {
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🎯 포지션 설정')
    .setDescription(getUserStatusText(pickedUsers, positionData))
    .setFooter({ text: '각 유저의 설정 버튼을 클릭하세요' });

  const rows = [];
  let currentRow = new ActionRowBuilder();

  pickedUsers.forEach((nickname, index) => {
    const data = positionData[nickname];
    const teamEmoji = { '랜덤': '🎲', '1팀': '🐶', '2팀': '🐱' }[data.team];
    const posEmoji = {
      '랜덤': '🎲', '탑': '🛡️', '정글': '🌲',
      '미드': '🔥', '원딜': '🏹', '서폿': '💚'
    }[data.position];

    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`posConfig|${timeKey}|${nickname}`)
        .setLabel(`${index + 1}. ${nickname.substring(0, 8)}`)
        .setEmoji(teamEmoji)
        .setStyle(ButtonStyle.Secondary)
    );

    // 5개씩 새 줄
    if ((index + 1) % 5 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  });

  // 남은 버튼 추가
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

function getUserStatusText(pickedUsers, positionData) {
  let text = '';
  pickedUsers.forEach((nickname, index) => {
    const data = positionData[nickname];
    const teamEmoji = { '랜덤': '🎲', '1팀': '🐶', '2팀': '🐱' }[data.team];
    const posEmoji = {
      '랜덤': '🎲', '탑': '🛡️', '정글': '🌲',
      '미드': '🔥', '원딜': '🏹', '서폿': '💚'
    }[data.position];
    text += `${index + 1}. **${nickname}** - ${teamEmoji} ${data.team} / ${posEmoji} ${data.position}\n`;
  });
  return text;
}

// 2. Modal 생성 (버튼 클릭 시)
function buildPositionModal(nickname, currentData) {
  const modal = new ModalBuilder()
    .setCustomId(`posModal|${nickname}`)
    .setTitle(`${nickname} 설정`);

  // 팀 입력
  const teamInput = new TextInputBuilder()
    .setCustomId('team')
    .setLabel('팀 (랜덤, 1팀, 2팀 중 입력)')
    .setStyle(TextInputStyle.Short)
    .setValue(currentData.team)
    .setPlaceholder('예: 1팀')
    .setRequired(true)
    .setMaxLength(10);

  // 포지션 입력
  const positionInput = new TextInputBuilder()
    .setCustomId('position')
    .setLabel('포지션 (랜덤, 탑, 정글, 미드, 원딜, 서폿)')
    .setStyle(TextInputStyle.Short)
    .setValue(currentData.position)
    .setPlaceholder('예: 미드')
    .setRequired(true)
    .setMaxLength(10);

  modal.addComponents(
    new ActionRowBuilder().addComponents(teamInput),
    new ActionRowBuilder().addComponents(positionInput)
  );

  return modal;
}

// 3. Modal Submit 핸들러 (discord.js 파일에 추가)
async function handleModalSubmit(interaction, pickUsersData) {
  if (!interaction.customId.startsWith('posModal|')) return;

  const nickname = interaction.customId.split('|')[1];
  const teamInput = interaction.fields.getTextInputValue('team').trim();
  const positionInput = interaction.fields.getTextInputValue('position').trim();

  // 입력 검증
  const validTeams = ['랜덤', '1팀', '2팀'];
  const validPositions = ['랜덤', '탑', '정글', '미드', '원딜', '서폿'];

  if (!validTeams.includes(teamInput)) {
    await interaction.reply({
      content: `❌ 잘못된 팀입니다. "랜덤", "1팀", "2팀" 중 하나를 입력하세요.`,
      ephemeral: true
    });
    return;
  }

  if (!validPositions.includes(positionInput)) {
    await interaction.reply({
      content: `❌ 잘못된 포지션입니다. "랜덤", "탑", "정글", "미드", "원딜", "서폿" 중 하나를 입력하세요.`,
      ephemeral: true
    });
    return;
  }

  // 데이터 업데이트 (원본 메시지에서 timeKey 찾아야 함)
  // 실제 구현 시 timeKey를 어떻게 찾을지 결정 필요
  const message = interaction.message;
  const timeKey = message.components[0].components[0].data.custom_id.split('|')[1];
  const data = pickUsersData.get(timeKey);

  if (!data) {
    await interaction.reply({
      content: '데이터가 만료되었습니다. 다시 인원뽑기를 해주세요.',
      ephemeral: true
    });
    return;
  }

  // 설정 업데이트
  data.positionData[nickname] = {
    team: teamInput,
    position: positionInput
  };

  pickUsersData.set(timeKey, data);

  // UI 갱신
  const pickUsersCommand = require('./commands/pick-users');
  const ui = buildUserButtons(data.pickedUsers, data.positionData, timeKey);

  await interaction.update(ui);
  await interaction.followUp({
    content: `✅ **${nickname}**의 설정이 저장되었습니다!\n팀: ${teamInput} / 포지션: ${positionInput}`,
    ephemeral: true
  });
}

module.exports = {
  buildUserButtons,
  buildPositionModal,
  handleModalSubmit
};
