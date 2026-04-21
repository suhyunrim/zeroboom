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
const { getEmojiObject } = require('./emoji-manager');

// 포지션 폴백 이모지 (커스텀 이모지 없을 때)
const POSITION_FALLBACK_EMOJI = {
  TOP: '⚔️',
  JUNGLE: '🐺',
  MIDDLE: '✨',
  BOTTOM: '🏹',
  UTILITY: '💖',
};

// 포지션 SelectMenu 옵션 빌더 (커스텀 이모지 동적 적용)
function buildPositionOptions() {
  return [
    { label: 'TOP', value: 'TOP', emoji: getEmojiObject('TOP') || '⚔️', description: '탑 라인' },
    { label: 'JUNGLE', value: 'JUNGLE', emoji: getEmojiObject('JUNGLE') || '🐺', description: '정글' },
    { label: 'MIDDLE', value: 'MIDDLE', emoji: getEmojiObject('MIDDLE') || '✨', description: '미드 라인' },
    { label: 'BOTTOM', value: 'BOTTOM', emoji: getEmojiObject('BOTTOM') || '🏹', description: 'AD 캐리' },
    { label: 'UTILITY', value: 'UTILITY', emoji: getEmojiObject('UTILITY') || '💖', description: '서포터' },
  ];
}

// 티어 카테고리 (2줄, 각 5개)
const TIER_ROW_1 = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
const TIER_ROW_2 = ['EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

// 단계 없는 티어 (바로 닉네임 입력으로 이동)
const NON_STEP_TIERS = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];

// 티어 단계
const TIER_STEPS = ['IV', 'III', 'II', 'I'];

// 티어 폴백 이모지 (커스텀 이모지 없을 때)
const TIER_FALLBACK_EMOJI = {
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

/**
 * 티어 버튼용 이모지 객체 반환 (커스텀 이모지 또는 유니코드 폴백)
 */
function getTierButtonEmoji(tier) {
  return getEmojiObject(tier) || TIER_FALLBACK_EMOJI[tier];
}

/**
 * 텍스트 표시용 이모지 문자열 반환
 */
function getTierDisplayEmoji(tier) {
  const obj = getEmojiObject(tier);
  return obj ? `<:${obj.name}:${obj.id}>` : TIER_FALLBACK_EMOJI[tier];
}

function getPositionDisplayEmoji(position) {
  const obj = getEmojiObject(position);
  return obj ? `<:${obj.name}:${obj.id}>` : POSITION_FALLBACK_EMOJI[position];
}

/**
 * 포지션 선택 화면 (뒤로가기용)
 */
function buildPositionView(guildId, prefix) {
  const isTest = prefix === 'onboardTest';
  const embed = new EmbedBuilder()
    .setColor(isTest ? '#ffa500' : '#0099ff')
    .setTitle('🎮 주 포지션을 선택해주세요')
    .setDescription(
      (isTest ? '⚠️ 테스트 모드: DB 저장 없이 플로우만 확인합니다.\n\n' : '') +
      '자신의 **주 포지션**을 다시 선택해주세요.',
    );

  const positionSelect = new StringSelectMenuBuilder()
    .setCustomId(`${prefix}|pos|${guildId}`)
    .setPlaceholder('포지션을 선택하세요')
    .addOptions(buildPositionOptions());

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(positionSelect)],
  };
}

/**
 * 티어 카테고리 선택 화면 (+ 뒤로가기)
 */
function buildTierCategoryView(guildId, position, prefix) {
  const isTest = prefix === 'onboardTest';
  const embed = new EmbedBuilder()
    .setColor(isTest ? '#ffa500' : '#0099ff')
    .setTitle('🎮 티어를 선택해주세요')
    .setDescription(`포지션: ${getPositionDisplayEmoji(position)} **${position}**\n\n자신의 티어를 선택해주세요.`);

  const row1 = new ActionRowBuilder().addComponents(
    TIER_ROW_1.map((tier) =>
      new ButtonBuilder()
        .setCustomId(`${prefix}|tier|${guildId}|${position}|${tier}`)
        .setLabel(tier)
        .setEmoji(getTierButtonEmoji(tier))
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  const row2 = new ActionRowBuilder().addComponents(
    TIER_ROW_2.map((tier) =>
      new ButtonBuilder()
        .setCustomId(`${prefix}|tier|${guildId}|${position}|${tier}`)
        .setLabel(tier)
        .setEmoji(getTierButtonEmoji(tier))
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}|back|${guildId}|pos`)
      .setLabel('뒤로')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2, backRow] };
}

/**
 * 티어 단계 선택 화면 (+ 뒤로가기)
 */
function buildTierStepView(guildId, position, tierCategory, prefix) {
  const isTest = prefix === 'onboardTest';
  const embed = new EmbedBuilder()
    .setColor(isTest ? '#ffa500' : '#0099ff')
    .setTitle(`${getTierDisplayEmoji(tierCategory)} ${tierCategory} - 단계를 선택해주세요`)
    .setDescription(
      `포지션: ${getPositionDisplayEmoji(position)} **${position}**\n티어: ${getTierDisplayEmoji(tierCategory)} **${tierCategory}**`,
    );

  const stepRow = new ActionRowBuilder().addComponents(
    TIER_STEPS.map((s) =>
      new ButtonBuilder()
        .setCustomId(`${prefix}|tierStep|${guildId}|${position}|${tierCategory}_${s}`)
        .setLabel(`${tierCategory} ${s}`)
        .setStyle(ButtonStyle.Primary),
    ),
  );

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}|back|${guildId}|${position}|tier`)
      .setLabel('뒤로')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [stepRow, backRow] };
}

// 온보딩 진행 중인 유저 추적 (discordId Set)
const onboardingInProgress = new Set();

/**
 * 온보딩 DM 전송 시작
 * @param {Object} options
 * @param {boolean} [options.testMode=false] - true면 DB 저장 없이 테스트만 진행
 * @returns {boolean} DM 전송 여부
 */
async function startOnboarding(member, group, { testMode = false } = {}) {
  const prefix = testMode ? 'onboardTest' : 'onboard';

  // 이미 온보딩 진행 중이면 중복 발송 안 함
  if (!testMode && onboardingInProgress.has(member.id)) {
    logger.info(`온보딩 DM 스킵 (진행 중): ${member.displayName} (${member.id})`);
    return false;
  }

  try {
    if (!testMode) {
      onboardingInProgress.add(member.id);
      // 30분 후 자동 해제
      setTimeout(() => onboardingInProgress.delete(member.id), 30 * 60 * 1000);
    }
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
      .addOptions(buildPositionOptions());

    await dm.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(positionSelect)],
    });

    logger.info(`온보딩 DM 전송: ${member.displayName} (${member.id}) - 그룹 ${group.id}`);
  } catch (e) {
    if (!testMode) onboardingInProgress.delete(member.id);
    logger.warn(`온보딩 DM 전송 실패: ${member.displayName} (${member.id}) - ${e.message}`);
    return false;
  }
  return true;
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
    await interaction.update(buildTierCategoryView(guildId, position, prefix));
  }
}

/**
 * Button 인터랙션 핸들러 (티어 선택, 닉네임 입력)
 */
async function handleOnboardButton(interaction) {
  const split = interaction.customId.split('|');
  const prefix = split[0]; // 'onboard' 또는 'onboardTest'
  const step = split[1];

  // 채널 공지에서 "소환사 등록하기" 버튼 클릭 → DM으로 온보딩 시작
  if (step === 'start') {
    const guildId = split[2];
    try {
      const group = await models.group.findOne({ where: { discordGuildId: guildId } });
      if (!group) {
        await interaction.reply({ content: '등록된 그룹을 찾을 수 없습니다.', ephemeral: true });
        return;
      }

      // 이미 등록된 유저인지 확인
      const existingUser = await models.user.findOne({
        where: { groupId: group.id, discordId: interaction.user.id },
      });
      if (existingUser) {
        await interaction.reply({ content: '이미 등록되어 있습니다! 🎮', ephemeral: true });
        return;
      }

      const member = interaction.guild
        ? await interaction.guild.members.fetch(interaction.user.id)
        : interaction.member;

      await startOnboarding(member, group);
      await interaction.reply({ content: 'DM으로 등록 안내를 보냈습니다! 확인해주세요 📩', ephemeral: true });
    } catch (e) {
      logger.error('온보딩 시작 버튼 오류:', e);
      await interaction.reply({ content: 'DM 전송에 실패했습니다. DM 설정을 확인해주세요.', ephemeral: true });
    }
    return;
  }

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

    await interaction.update(buildTierStepView(guildId, position, tierCategory, prefix));
  } else if (step === 'back') {
    // 뒤로가기: 대상 단계에 따라 이전 화면 재구성
    const guildId = split[2];
    const target = split[split.length - 1];

    if (target === 'pos') {
      await interaction.update(buildPositionView(guildId, prefix));
    } else if (target === 'tier') {
      const position = split[3];
      await interaction.update(buildTierCategoryView(guildId, position, prefix));
    } else if (target === 'tierStep') {
      const position = split[3];
      const tierCategory = split[4];
      await interaction.update(buildTierStepView(guildId, position, tierCategory, prefix));
    }
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
      `포지션: ${getPositionDisplayEmoji(position)} **${position}**\n` +
      `티어: ${getTierDisplayEmoji(tierCategory)} **${tierDisplay}**\n\n` +
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

  // 뒤로가기: MASTER+는 티어 카테고리로, 나머지는 티어 단계로
  const backCustomId = NON_STEP_TIERS.includes(tierCategory)
    ? `${prefix}|back|${guildId}|${position}|tier`
    : `${prefix}|back|${guildId}|${position}|${tierCategory}|tierStep`;

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(backCustomId)
      .setLabel('뒤로')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({
    embeds: [embed],
    components: [row, backRow],
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
          `포지션: ${getPositionDisplayEmoji(position)} **${position}**\n` +
          `티어: ${getTierDisplayEmoji(tierCategory)} **${tier}**\n` +
          `그룹: **${group.groupName}**`,
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // 유저 등록 (기존 서비스 재사용)
    const result = await registerUser(group.groupName, summonerName, tier, interaction.user.id);

    if (result.status === 200) {
      onboardingInProgress.delete(interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('✅ 등록 완료!')
        .setDescription(
          `${result.result}\n\n` +
          `포지션: ${getPositionDisplayEmoji(position)} **${position}**\n` +
          `티어: ${getTierDisplayEmoji(tierCategory)} **${tier}**\n\n` +
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
