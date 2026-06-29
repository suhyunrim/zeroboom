const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ChannelType,
} = require('discord.js');
const { logger } = require('../loaders/logger');
const models = require('../db/models');
const { registerUser } = require('../services/user');
const auditLog = require('../controller/audit-log');
const { getEmojiObject } = require('./emoji-manager');
const { getCustomExtra } = require('./onboarding-messages');
const { isDiscordAdmin } = require('./adminSync');

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

// LP 단위로 표시하는 티어 (UI만 LP, 내부 저장은 IV/III/II/I 그대로 → rating 시스템 변경 없음)
const LP_TIERS = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];

// 티어 단계 (내부 저장값)
const TIER_STEPS = ['IV', 'III', 'II', 'I'];

// LP 티어 표시 매핑 (IV=0, III=100, II=200, I=300)
const LP_BY_STEP = {
  IV: 0, III: 100, II: 200, I: 300,
};
const LP_TIER_ABBR = { MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'C' };

/**
 * "MASTER I" → "MASTER 300LP"로 표시용 변환. 일반 티어는 그대로 반환.
 */
function formatTierForDisplay(tier) {
  const [cat, step] = tier.split(' ');
  if (LP_TIERS.includes(cat) && LP_BY_STEP[step] !== undefined) {
    return `${cat} ${LP_BY_STEP[step]}LP`;
  }
  return tier;
}

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
 * 포지션 선택 화면 (첫 진입 + 뒤로가기 공용)
 */
function buildPositionView(guildId, prefix, guildName, group) {
  const isTest = prefix === 'onboardTest';
  const embed = new EmbedBuilder()
    .setColor(isTest ? '#ffa500' : '#0099ff')
    .setTitle(isTest ? '🧪 온보딩 테스트 모드' : `🎮 ${guildName}에 오신 것을 환영합니다!`)
    .setDescription(
      (isTest ? '⚠️ 테스트 모드: DB 저장 없이 플로우만 확인합니다.\n\n' : '') +
      '내전 참가를 위해 간단한 등록을 진행합니다.\n먼저 **주 포지션**을 선택해주세요.' +
      getCustomExtra(group, 'welcome'),
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
function buildTierCategoryView(guildId, position, prefix, group) {
  const isTest = prefix === 'onboardTest';
  const embed = new EmbedBuilder()
    .setColor(isTest ? '#ffa500' : '#0099ff')
    .setTitle('🎮 티어를 선택해주세요')
    .setDescription(
      `포지션: ${getPositionDisplayEmoji(position)} **${position}**\n\n자신의 티어를 선택해주세요.` +
      getCustomExtra(group, 'tierCategory'),
    );

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
function buildTierStepView(guildId, position, tierCategory, prefix, group) {
  const isTest = prefix === 'onboardTest';
  const embed = new EmbedBuilder()
    .setColor(isTest ? '#ffa500' : '#0099ff')
    .setTitle(`${getTierDisplayEmoji(tierCategory)} ${tierCategory} - 단계를 선택해주세요`)
    .setDescription(
      `포지션: ${getPositionDisplayEmoji(position)} **${position}**\n티어: ${getTierDisplayEmoji(tierCategory)} **${tierCategory}**` +
      getCustomExtra(group, 'tierStep'),
    );

  const isLpTier = LP_TIERS.includes(tierCategory);
  const stepRow = new ActionRowBuilder().addComponents(
    TIER_STEPS.map((s) =>
      new ButtonBuilder()
        .setCustomId(`${prefix}|tierStep|${guildId}|${position}|${tierCategory}_${s}`)
        .setLabel(isLpTier ? `${LP_TIER_ABBR[tierCategory]} ${LP_BY_STEP[s]}LP` : `${tierCategory} ${s}`)
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

// 관리자 대행 등록 추적: `${guildId}:${actorDiscordId}` -> { targetId, timer }
// 채널 폴백에서 관리자가 신규 유저 대신 등록을 진행할 때, 최종 등록 대상을 기억한다.
const onBehalfTargets = new Map();
const ON_BEHALF_TTL = 30 * 60 * 1000;

function setOnBehalf(guildId, actorId, targetId) {
  const key = `${guildId}:${actorId}`;
  const prev = onBehalfTargets.get(key);
  if (prev?.timer) clearTimeout(prev.timer);
  const timer = setTimeout(() => onBehalfTargets.delete(key), ON_BEHALF_TTL);
  if (timer.unref) timer.unref();
  onBehalfTargets.set(key, { targetId, timer });
}

function clearOnBehalf(guildId, actorId) {
  const key = `${guildId}:${actorId}`;
  const prev = onBehalfTargets.get(key);
  if (prev?.timer) clearTimeout(prev.timer);
  onBehalfTargets.delete(key);
}

function getOnBehalfTarget(guildId, actorId) {
  return onBehalfTargets.get(`${guildId}:${actorId}`)?.targetId || null;
}

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
    await dm.send(buildPositionView(member.guild.id, prefix, member.guild.name, group));

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
    const group = await models.group.findOne({ where: { discordGuildId: guildId } });
    await interaction.update(buildTierCategoryView(guildId, position, prefix, group));
  }
}

/**
 * Button 인터랙션 핸들러 (티어 선택, 닉네임 입력)
 */
async function handleOnboardButton(interaction) {
  const split = interaction.customId.split('|');
  const prefix = split[0]; // 'onboard' 또는 'onboardTest'
  const step = split[1];

  // 채널 공지에서 "소환사 등록하기" 버튼 클릭 → 채널 ephemeral로 온보딩 진행
  if (step === 'start') {
    const guildId = split[2];
    const targetId = split[3] || interaction.user.id; // 폴백 메시지의 신규 유저 (구버전 메시지는 클릭자)
    try {
      const group = await models.group.findOne({ where: { discordGuildId: guildId } });
      if (!group) {
        await interaction.reply({ content: '등록된 그룹을 찾을 수 없습니다.', ephemeral: true });
        return;
      }

      // 본인 또는 관리자만 진행 가능 (관리자는 신규 유저 대신 진행)
      const isSelf = interaction.user.id === targetId;
      const isAdmin = interaction.member ? isDiscordAdmin(interaction.member) : false;
      if (!isSelf && !isAdmin) {
        await interaction.reply({
          content: `🔒 이 등록 안내는 <@${targetId}> 님을 위한 거예요. 본인 또는 관리자만 진행할 수 있어요.`,
          ephemeral: true,
        });
        return;
      }

      // 이미 등록된 유저인지 확인 (대행 시 대상 기준)
      const existingUser = await models.user.findOne({
        where: { groupId: group.id, discordId: targetId },
      });
      if (existingUser) {
        await interaction.reply({
          content: isSelf ? '이미 등록되어 있습니다! 🎮' : `<@${targetId}> 님은 이미 등록되어 있습니다! 🎮`,
          ephemeral: true,
        });
        return;
      }

      // 관리자 대행이면 최종 등록 대상 기억, 본인 진행이면 기존 대행정보 제거
      if (!isSelf) setOnBehalf(guildId, interaction.user.id, targetId);
      else clearOnBehalf(guildId, interaction.user.id);

      // DM 대신 채널에서 본인에게만 보이는(ephemeral) 등록 UI로 진행 → DM 차단 유저도 등록 가능
      const guildName = interaction.guild?.name ?? '';
      await interaction.reply({
        content: isSelf ? undefined : `👮 <@${targetId}> 님 대신 등록을 진행합니다.`,
        ...buildPositionView(guildId, 'onboard', guildName, group),
        ephemeral: true,
      });
    } catch (e) {
      logger.error('온보딩 시작 버튼 오류:', e);
      await interaction.reply({ content: '등록 화면을 여는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', ephemeral: true });
    }
    return;
  }

  if (step === 'tier') {
    const guildId = split[2];
    const position = split[3];
    const tierCategory = split[4];
    const group = await models.group.findOne({ where: { discordGuildId: guildId } });
    await interaction.update(buildTierStepView(guildId, position, tierCategory, prefix, group));
  } else if (step === 'back') {
    // 뒤로가기: 대상 단계에 따라 이전 화면 재구성
    const guildId = split[2];
    const target = split[split.length - 1];
    const group = await models.group.findOne({ where: { discordGuildId: guildId } });

    if (target === 'pos') {
      const guildName = interaction.client.guilds.cache.get(guildId)?.name ?? '';
      await interaction.update(buildPositionView(guildId, prefix, guildName, group));
    } else if (target === 'tier') {
      const position = split[3];
      await interaction.update(buildTierCategoryView(guildId, position, prefix, group));
    } else if (target === 'tierStep') {
      const position = split[3];
      const tierCategory = split[4];
      await interaction.update(buildTierStepView(guildId, position, tierCategory, prefix, group));
    }
  } else if (step === 'tierStep') {
    const guildId = split[2];
    const position = split[3];
    const tier = split[4].replace('_', ' '); // "GOLD_II" → "GOLD II"
    const group = await models.group.findOne({ where: { discordGuildId: guildId } });
    await showNameInput(interaction, guildId, position, tier, prefix, group);
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
async function showNameInput(interaction, guildId, position, tier, prefix = 'onboard', group = null) {
  const tierDisplay = tier.replace('_', ' ');
  const tierCategory = tierDisplay.split(' ')[0];

  const embed = new EmbedBuilder()
    .setColor(prefix === 'onboardTest' ? '#ffa500' : '#0099ff')
    .setTitle('🎮 거의 다 됐어요!')
    .setDescription(
      `포지션: ${getPositionDisplayEmoji(position)} **${position}**\n`
      + `티어: ${getTierDisplayEmoji(tierCategory)} **${formatTierForDisplay(tierDisplay)}**\n\n`
      + '아래 버튼을 눌러 롤 닉네임을 입력해주세요.'
      + getCustomExtra(group, 'nameInput'),
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

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}|back|${guildId}|${position}|${tierCategory}|tierStep`)
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

  // 관리자 대행이면 등록 대상은 클릭자가 아니라 신규 유저. (대행 정보 없으면 본인)
  // 대행 매핑은 채널(길드) 흐름에서만 생기므로, DM 흐름에선 참조하지 않는다(잔여 매핑 오염 방지).
  const registrantId =
    (!isTestMode && interaction.inGuild() && getOnBehalfTarget(guildId, interaction.user.id)) || interaction.user.id;
  const onBehalf = registrantId !== interaction.user.id;

  // 채널(길드) ephemeral 흐름이면 결과도 본인에게만 보이게, DM 흐름이면 기존대로
  await interaction.deferReply({ ephemeral: interaction.inGuild() });

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
          `티어: ${getTierDisplayEmoji(tierCategory)} **${formatTierForDisplay(tier)}**\n` +
          `그룹: **${group.groupName}**`,
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // 유저 등록 (기존 서비스 재사용) — 대행이면 신규 유저(registrantId)로 등록
    const result = await registerUser(group.groupName, summonerName, tier, registrantId);

    if (result.status === 200) {
      onboardingInProgress.delete(registrantId);
      clearOnBehalf(guildId, interaction.user.id);

      const rawUrl = process.env.FRONTEND_URL;
      const frontendUrl = rawUrl && !rawUrl.startsWith('http') ? `http://${rawUrl}` : rawUrl;
      const frontendLine = frontendUrl
        ? `\n\n🌐 전적·프로필·랭킹은 여기서: ${frontendUrl}`
        : '';
      const onBehalfLine = onBehalf ? `👮 <@${registrantId}> 님 등록을 대신 완료했어요.\n\n` : '';

      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('✅ 등록 완료!')
        .setDescription(
          onBehalfLine
          + `${result.result}\n\n`
          + `포지션: ${getPositionDisplayEmoji(position)} **${position}**\n`
          + `티어: ${getTierDisplayEmoji(tierCategory)} **${formatTierForDisplay(tier)}**\n\n`
          + '내전에서 만나요! 🎮'
          + frontendLine
          + getCustomExtra(group, 'complete'),
        );

      await interaction.editReply({ embeds: [embed] });

      // Discord Role 부여 (기본 역할 + 포지션 역할 + 티어 역할) — 대상은 registrantId
      await assignDiscordRoles(client, guildId, registrantId, group, position, tierCategory);

      // 감사 로그 (수행자=클릭자, 대상=registrantId)
      auditLog.log({
        groupId: group.id,
        actorDiscordId: interaction.user.id,
        actorName: interaction.user.displayName,
        action: 'user.onboard',
        details: { summonerName, position, tier, onboardedDiscordId: registrantId, onBehalf },
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

/**
 * 온보딩 폴백을 게시할 채널 결정
 * 우선순위: settings.onboardingChannelId → systemChannel → 봇이 글 쓸 수 있는 첫 텍스트 채널
 */
function resolveOnboardingChannel(guild, group) {
  const me = guild.members.me;
  const canSend = (ch) =>
    ch && ch.isTextBased?.() && ch.permissionsFor(me)?.has('SendMessages');

  const channelId = group.settings?.onboardingChannelId;
  if (channelId) {
    const ch = guild.channels.cache.get(channelId);
    if (canSend(ch)) return ch;
  }
  if (canSend(guild.systemChannel)) return guild.systemChannel;
  return guild.channels.cache.find((ch) => ch.type === ChannelType.GuildText && canSend(ch)) || null;
}

/**
 * DM 전송 실패 시 채널에 등록 안내(버튼) 폴백 게시
 * @returns {boolean} 게시 성공 여부
 */
async function sendOnboardingFallback(member, group) {
  const guild = member.guild;
  const channel = resolveOnboardingChannel(guild, group);
  if (!channel) {
    logger.warn(`온보딩 폴백 채널 없음: 그룹 ${group.id} (${guild.id})`);
    return false;
  }

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🎮 소환사 등록 안내')
    .setDescription(
      `${member} 님, 환영합니다!\n\n`
      + 'DM이 막혀 있어 등록 안내를 보내드리지 못했어요. 😢\n'
      + '아래 **[소환사 등록하기]** 버튼을 누르면 이 채널에서 바로 등록할 수 있어요.\n\n'
      + '※ DM으로 받고 싶다면 **서버 설정 → 개인정보 보호 → "서버 멤버가 보내는 DM 허용"** 을 켜주세요.'
      + getCustomExtra(group, 'welcome'),
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`onboard|start|${guild.id}|${member.id}`)
      .setLabel('소환사 등록하기')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary),
  );

  try {
    await channel.send({ content: `${member}`, embeds: [embed], components: [row] });
    logger.info(`온보딩 폴백 채널 안내: ${member.displayName} (${member.id}) - 그룹 ${group.id} - #${channel.name}`);
    return true;
  } catch (e) {
    logger.warn(`온보딩 폴백 채널 전송 실패: 그룹 ${group.id} - ${e.message}`);
    return false;
  }
}

module.exports = {
  startOnboarding,
  sendOnboardingFallback,
  handleOnboardSelectMenu,
  handleOnboardButton,
  handleOnboardModalSubmit,
};
