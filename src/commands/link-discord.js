const models = require('../db/models');
const { syncUserAdminRole } = require('../discord/adminSync');
const { logger } = require('../loaders/logger');
const { findGroupSummoner } = require('../utils/summoner-lookup');

exports.run = async (groupName, interaction) => {
  const discordUser = interaction.options.getUser('디스코드유저');
  const summonerName = interaction.options.getString('롤닉네임');

  if (!discordUser) {
    return '디스코드 유저를 멘션해주세요.';
  }

  if (!summonerName) {
    return '롤 닉네임을 입력해주세요.';
  }

  const group = await models.group.findOne({
    where: { groupName },
  });

  if (!group) {
    return '그룹 정보를 찾을 수 없습니다.';
  }

  // 소환사 찾기 — 그룹 멤버 중 simplifiedName 일치자(타그룹/orphan 동명이인 방지)
  const simplifiedName = summonerName.toLowerCase().replace(/ /g, '');
  const summoner = await findGroupSummoner(models, group.id, { simplifiedName });

  if (!summoner) {
    return `[${summonerName}] 소환사를 찾을 수 없습니다.`;
  }

  // 유저 찾기
  const user = await models.user.findOne({
    where: { groupId: group.id, puuid: summoner.puuid },
  });

  if (!user) {
    return `[${summonerName}]은(는) 그룹에 등록되지 않은 유저입니다.`;
  }

  // discordId 업데이트
  await user.update({ discordId: discordUser.id });

  // 연결된 디스코드 계정 권한으로 role 즉시 동기화
  if (interaction.guild) {
    try {
      const member = await interaction.guild.members.fetch(discordUser.id);
      await syncUserAdminRole(member, group);
    } catch (e) {
      logger.warn(`디코연동 권한 동기화 실패: ${e.message}`);
    }
  }

  return `[**${summonerName}**] ↔ <@${discordUser.id}> 연결 완료!`;
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
  description: '기존 유저에 디스코드 계정 연결',
  usage: '/유저디코연결 @디스코드유저 롤닉네임',
};
