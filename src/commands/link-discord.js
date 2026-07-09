const { Op } = require('sequelize');
const models = require('../db/models');
const auditLog = require('../controller/audit-log');
const { syncUserAdminRole } = require('../discord/adminSync');
const { logger } = require('../loaders/logger');
const { findGroupSummoner } = require('../utils/summoner-lookup');

// 연결 후 권한(role) 동기화 (실패해도 연결은 완료로 둔다)
const syncRole = async (interaction, discordId, group) => {
  if (!interaction.guild) return;
  try {
    const member = await interaction.guild.members.fetch(discordId);
    await syncUserAdminRole(member, group);
  } catch (e) {
    logger.warn(`디코연동 권한 동기화 실패: ${e.message}`);
  }
};

exports.run = async (groupName, interaction) => {
  const discordUser = interaction.options.getUser('디스코드유저');
  const summonerName = interaction.options.getString('롤닉네임');

  if (!discordUser) {
    return '디스코드 유저를 멘션해주세요.';
  }

  if (!summonerName) {
    return '롤 닉네임을 입력해주세요.';
  }

  const group = await models.group.findOne({ where: { groupName } });
  if (!group) {
    return '그룹 정보를 찾을 수 없습니다.';
  }

  // 소환사 찾기 — 그룹 멤버 중 simplifiedName 일치자(타그룹/orphan 동명이인 방지)
  const simplifiedName = summonerName.toLowerCase().replace(/ /g, '');
  const summoner = await findGroupSummoner(models, group.id, { simplifiedName });
  if (!summoner) {
    return `[${summonerName}] 소환사를 찾을 수 없습니다.`;
  }

  const target = await models.user.findOne({
    where: { groupId: group.id, puuid: summoner.puuid },
  });
  if (!target) {
    return `[${summonerName}]은(는) 그룹에 등록되지 않은 유저입니다.`;
  }

  // 이미 이 디코에 본캐로 연결돼 있으면 아무것도 하지 않는다.
  if (target.discordId === discordUser.id && !target.primaryPuuid) {
    return `[**${summonerName}**]은(는) 이미 <@${discordUser.id}>에 연결돼 있습니다.`;
  }

  const actorId = interaction.user ? interaction.user.id : null;
  const actorName = interaction.user
    ? interaction.user.globalName || interaction.user.username || null
    : null;

  // 같은 그룹에서 이 디스코드를 이미 물고 있는 다른 본캐(홀더)를 찾는다.
  // (groupId, discordId) UNIQUE 제약 때문에 홀더가 있으면 그냥 붙이면 실패한다.
  const holder = await models.user.findOne({
    where: {
      groupId: group.id,
      discordId: discordUser.id,
      primaryPuuid: null,
      puuid: { [Op.ne]: summoner.puuid },
    },
  });

  // 충돌 없음 → 바로 연결
  if (!holder) {
    await models.sequelize.transaction(async (t) => {
      await target.update({ discordId: discordUser.id, primaryPuuid: null }, { transaction: t });
    });
    auditLog.log({
      groupId: group.id,
      actorDiscordId: actorId,
      actorName,
      action: 'user.discord_link',
      details: { puuid: summoner.puuid, name: summoner.name, discordId: discordUser.id },
    });
    await syncRole(interaction, discordUser.id, group);
    return `[**${summonerName}**] ↔ <@${discordUser.id}> 연결 완료!`;
  }

  // 충돌 있음 → 기존 홀더를 해제하고 target을 새 본캐로 이동한다.
  // (관리자가 대상 계정을 명시해 실행한 것이므로 "이동"이 명확한 의도. 통계/매치는 각 puuid에 보존)
  const holderSummoner = await models.summoner.findOne({
    where: { puuid: holder.puuid },
    attributes: ['name'],
  });
  const holderName = holderSummoner ? holderSummoner.name : '다른 계정';

  await models.sequelize.transaction(async (t) => {
    await holder.update({ discordId: null }, { transaction: t });
    await target.update({ discordId: discordUser.id, primaryPuuid: null }, { transaction: t });
  });
  auditLog.log({
    groupId: group.id,
    actorDiscordId: actorId,
    actorName,
    action: 'user.discord_relink',
    details: {
      discordId: discordUser.id,
      from: holder.puuid,
      fromName: holderName,
      to: summoner.puuid,
      toName: summoner.name,
    },
  });
  await syncRole(interaction, discordUser.id, group);
  return `[**${holderName}**] 연결을 해제하고 [**${summonerName}**] ↔ <@${discordUser.id}>로 이동했습니다.`;
};

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['유저디코연결'],
  args: [
    ['user', '디스코드유저', '연결할 디스코드 유저를 멘션해주세요.', true],
    ['string', '롤닉네임', '롤 닉네임을 입력해주세요.', true],
  ],
};

exports.help = {
  name: 'link-discord',
  description: '기존 유저에 디스코드 계정 연결 (이미 다른 계정에 연결돼 있으면 그 계정으로 이동)',
  usage: '/유저디코연결 @디스코드유저 롤닉네임',
};
