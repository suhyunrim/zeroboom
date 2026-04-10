const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} = require('discord.js');
const { logger } = require('../loaders/logger');
const models = require('../db/models');
const { registerUser } = require('../services/user');
const auditLog = require('../controller/audit-log');

// 포지션 목록
const POSITIONS = [
  { label: 'TOP', value: 'TOP', emoji: '⚔️', description: '탑 라인' },
  { label: 'JUNGLE', value: 'JUNGLE', emoji: '🐺', description: '정글' },
  { label: 'MIDDLE', value: 'MIDDLE', emoji: '✨', description: '미드 라인' },
  { label: 'BOTTOM', value: 'BOTTOM', emoji: '🏹', description: 'AD 캐리' },
  { label: 'UTILITY', value: 'UTILITY', emoji: '💖', description: '서포터' },
];

// 티어 카테고리 (2줄, 각 5개)
const TIER_ROW_1 = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
const TIER_ROW_2 = ['EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

// 단계 없는 티어 (바로 닉네임 입력으로 이동)
const NON_STEP_TIERS = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];

// 티어 단계
const TIER_STEPS = ['IV', 'III', 'II', 'I'];

// 티어 이모지
const TIER_EMOJI = {
  IRON: '🪨',
  BRONZE: '🥉',
  SILVER: '🥈',
  GOLD: '🥇',
  PLATINUM: '💎',
  EMERALD: '💚',
  DIAMOND: '♦️',
  MASTER: '🏅',
  GRANDMASTER: '🔥',
  CHALLENGER: '👑',
};

// 포지션 이모지
const POSITION_EMOJI = {
  TOP: '⚔️',
  JUNGLE: '🐺',
  MIDDLE: '✨',
  BOTTOM: '🏹',
  UTILITY: '💖',
};

/**
 * 온보딩 DM 전송 시작
 * @param {Object} options
 * @param {boolean} [options.testMode=false] - true면 DB 저장 없이 테스트만 진행
 */
async function startOnboarding(member, group, { testMode = false } = {}) {
  const prefix = testMode ? 'onboardTest' : 'onboard';
  try {
    const dm = await member.createDM();

    const embed = new EmbedBuilder()
      .setColor(testMode ? '#ffa500' : '#0099ff')
      .setTitle(testMode
        ? '🧪 온보딩 테스트 모드'
        : `🎮 ${member.guild.name}에 오신 것을 환영합니다!`)
      .setDescription(
        (testMode ? '⚠️ 테스트 모드: DB 저장 없이 플로우만 확인합니다.\n\n' : '') +
        '내전 참가를 위해 간단한 등록을 진행합니다.\n먼저 **주 포지션**을 선택해주세요.',
      );

    const positionSelect = new StringSelectMenuBuilder()
      .setCustomId(`${prefix}|pos|${member.guild.id}`)
      .setPlaceholder('포지션을 선택하세요')
      .addOptions(POSITIONS);

    await dm.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(positionSelect)],
    });

    logger.info(`온보딩 DM 전송: ${member.displayName} (${member.id}) - 그룹 ${group.id}`);
  } catch (e) {
    logger.warn(`온보딩 DM 전송 실패: ${member.displayName} (${member.id}) - ${e.message}`);
  }
}

/**
 * SelectMenu 인터랙션 핸들러 (포지션 선택)
 */
async function handleOnboardSelectMenu(interaction) {
  const split = interaction.customId.split('|');
  const prefix = split[0]; // 'onboard' 또는 'onboardTest'
  const step = split[1]; // 'pos'
  const guildId = split[2];

  if (step === 'pos') {
    const position = interaction.values[0];

    const embed = new EmbedBuilder()
      .setColor(prefix === 'onboardTest' ? '#ffa500' : '#0099ff')
      .setTitle('🎮 티어를 선택해주세요')
      .setDescription(`포지션: ${POSITION_EMOJI[position]} **${position}**\n\n자신의 티어를 선택해주세요.`);

    // 티어 카테고리 버튼 2줄
    const row1 = new ActionRowBuilder().addComponents(
      TIER_ROW_1.map((tier) =>
        new ButtonBuilder()
          .setCustomId(`${prefix}|tier|${guildId}|${position}|${tier}`)
          .setLabel(tier)
          .setEmoji(TIER_EMOJI[tier])
          .setStyle(ButtonStyle.Secondary),
      ),
    );

    const row2 = new ActionRowBuilder().addComponents(
      TIER_ROW_2.map((tier) =>
        new ButtonBuilder()
          .setCustomId(`${prefix}|tier|${guildId}|${position}|${tier}`)
          .setLabel(tier)
          .setEmoji(TIER_EMOJI[tier])
          .setStyle(ButtonStyle.Secondary),
      ),
    );

    await interaction.update({
      embeds: [embed],
      components: [row1, row2],
    });
  }
}

/**
 * Button 인터랙션 핸들러 (티어 선택, 닉네임 입력)
 */
async function handleOnboardButton(interaction) {
  const split = interaction.customId.split('|');
  const prefix = split[0]; // 'onboard' 또는 'onboardTest'
  const step = split[1];

  if (step === 'tier') {
    const guildId = split[2];
    const position = split[3];
    const tierCategory = split[4];

    // MASTER/GM/CHALLENGER는 단계 없음 → 바로 닉네임 입력
    if (NON_STEP_TIERS.includes(tierCategory)) {
      const tier = `${tierCategory} I`;
      await showNameInput(interaction, guildId, position, tier, prefix);
      return;
    }

    // 단계 선택 버튼 (IV, III, II, I)
    const embed = new EmbedBuilder()
      .setColor(prefix === 'onboardTest' ? '#ffa500' : '#0099ff')
      .setTitle(`${TIER_EMOJI[tierCategory]} ${tierCategory} - 단계를 선택해주세요`)
      .setDescription(
        `포지션: ${POSITION_EMOJI[position]} **${position}**\n티어: ${TIER_EMOJI[tierCategory]} **${tierCategory}**`,
      );

    const row = new ActionRowBuilder().addComponents(
      TIER_STEPS.map((s) =>
        new ButtonBuilder()
          .setCustomId(`${prefix}|tierStep|${guildId}|${position}|${tierCategory}_${s}`)
          .setLabel(`${tierCategory} ${s}`)
          .setStyle(ButtonStyle.Primary),
      ),
    );

    await interaction.update({
      embeds: [embed],
      components: [row],
    });
  } else if (step === 'tierStep') {
    const guildId = split[2];
    const position = split[3];
    const tier = split[4].replace('_', ' '); // "GOLD_II" → "GOLD II"
    await showNameInput(interaction, guildId, position, tier, prefix);
  } else if (step === 'name') {
    const guildId = split[2];
    const position = split[3];
    const tier = split[4];

    const modal = new ModalBuilder()
      .setCustomId(`${prefix}|nameSubmit|${guildId}|${position}|${tier}`)
      .setTitle('롤 닉네임 입력');

    const nameInput = new TextInputBuilder()
      .setCustomId('summonerName')
      .setLabel('롤 닉네임 (예: Hide on bush#KR1)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('닉네임#태그');

    modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
    await interaction.showModal(modal);
  }
}

/**
 * 닉네임 입력 UI 표시
 */
async function showNameInput(interaction, guildId, position, tier, prefix = 'onboard') {
  const tierDisplay = tier.replace('_', ' ');
  const tierCategory = tierDisplay.split(' ')[0];

  const embed = new EmbedBuilder()
    .setColor(prefix === 'onboardTest' ? '#ffa500' : '#0099ff')
    .setTitle('🎮 거의 다 됐어요!')
    .setDescription(
      `포지션: ${POSITION_EMOJI[position]} **${position}**\n` +
      `티어: ${TIER_EMOJI[tierCategory]} **${tierDisplay}**\n\n` +
      '아래 버튼을 눌러 롤 닉네임을 입력해주세요.',
    );

  // tier에서 공백을 _로 치환 (customId에 공백 방지)
  const tierEncoded = tier.replace(' ', '_');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}|name|${guildId}|${position}|${tierEncoded}`)
      .setLabel('롤 닉네임 입력')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${prefix}|rso|disabled`)
      .setLabel('라이엇 계정 인증 (준비 중)')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );

  await interaction.update({
    embeds: [embed],
    components: [row],
  });
}

/**
 * Modal 제출 핸들러 (소환사명 등록)
 */
async function handleOnboardModalSubmit(interaction, client) {
  const split = interaction.customId.split('|');
  const prefix = split[0]; // 'onboard' 또는 'onboardTest'
  const isTestMode = prefix === 'onboardTest';
  const guildId = split[2];
  const position = split[3];
  const tier = split[4].replace('_', ' '); // "GOLD_II" → "GOLD II"
  const summonerName = interaction.fields.getTextInputValue('summonerName').trim();
  const tierCategory = tier.split(' ')[0];

  await interaction.deferReply();

  try {
    // 그룹 조회
    const group = await models.group.findOne({ where: { discordGuildId: guildId } });
    if (!group) {
      await interaction.editReply({ content: '등록된 그룹을 찾을 수 없습니다.' });
      return;
    }

    // 테스트 모드: DB 저장/역할 부여 없이 결과만 표시
    if (isTestMode) {
      const embed = new EmbedBuilder()
        .setColor('#ffa500')
        .setTitle('🧪 테스트 완료')
        .setDescription(
          '**아래 정보로 등록됩니다 (테스트 모드 - DB 저장 안 됨)**\n\n' +
          `소환사: **${summonerName}**\n` +
          `포지션: ${POSITION_EMOJI[position]} **${position}**\n` +
          `티어: ${TIER_EMOJI[tierCategory]} **${tier}**\n` +
          `그룹: **${group.groupName}**`,
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // 유저 등록 (기존 서비스 재사용)
    const result = await registerUser(group.groupName, summonerName, tier, interaction.user.id);

    if (result.status === 200) {
      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('✅ 등록 완료!')
        .setDescription(
          `${result.result}\n\n` +
          `포지션: ${POSITION_EMOJI[position]} **${position}**\n` +
          `티어: ${TIER_EMOJI[tierCategory]} **${tier}**\n\n` +
          '내전에서 만나요! 🎮',
        );

      await interaction.editReply({ embeds: [embed] });

      // Discord Role 부여 (기본 역할 + 포지션 역할 + 티어 역할)
      await assignDiscordRoles(client, guildId, interaction.user.id, group, position, tierCategory);

      // 감사 로그
      auditLog.log({
        groupId: group.id,
        actorDiscordId: interaction.user.id,
        actorName: interaction.user.displayName,
        action: 'user.onboard',
        details: { summonerName, position, tier },
        source: 'discord',
      });
    } else {
      // 등록 실패 → 재시도 버튼
      const tierEncoded = tier.replace(' ', '_');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${prefix}|name|${guildId}|${position}|${tierEncoded}`)
          .setLabel('다시 입력하기')
          .setEmoji('🔄')
          .setStyle(ButtonStyle.Primary),
      );

      await interaction.editReply({
        content: `등록에 실패했습니다: ${result.result}\n\n닉네임을 확인 후 다시 시도해주세요. (예: Hide on bush#KR1)`,
        components: [row],
      });
    }
  } catch (e) {
    logger.error(`온보딩 등록 오류: ${e.message}`);
    await interaction.editReply({
      content: '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    });
  }
}

/**
 * Discord Role 부여 (기본 + 포지션 + 티어)
 */
async function assignDiscordRoles(client, guildId, discordId, group, position, tierCategory) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const member = await guild.members.fetch(discordId);
    const settings = group.settings || {};
    const roleIds = [];

    // 기본 인증 역할
    if (settings.onboardingRoleId) {
      roleIds.push(settings.onboardingRoleId);
    }

    // 포지션별 역할
    if (settings.onboardingPositionRoles?.[position]) {
      roleIds.push(settings.onboardingPositionRoles[position]);
    }

    // 티어별 역할
    if (settings.onboardingTierRoles?.[tierCategory]) {
      roleIds.push(settings.onboardingTierRoles[tierCategory]);
    }

    if (roleIds.length === 0) return;

    await member.roles.add(roleIds);
    logger.info(`온보딩 역할 부여: ${discordId} - 그룹 ${group.id} - 역할 [${roleIds.join(', ')}]`);
  } catch (e) {
    logger.error(`온보딩 역할 부여 실패: ${e.message}`);
  }
}

module.exports = {
  startOnboarding,
  handleOnboardSelectMenu,
  handleOnboardButton,
  handleOnboardModalSubmit,
};
