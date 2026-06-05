const { PermissionFlagsBits } = require('discord.js');
const models = require('../db/models');
const { logger } = require('../loaders/logger');

/**
 * Discord 멤버가 ADMINISTRATOR 권한을 가지거나 길드 소유자인지 확인
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
function isDiscordAdmin(member) {
  // 봇 계정은 Administrator를 가져도 관리자로 취급하지 않는다.
  // 모든 권한 동기화 경로가 이 함수를 거치므로 봇 차단의 단일 지점.
  if (member.user?.bot) return false;
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.guild.ownerId === member.id
  );
}

/**
 * 단일 유저의 DB admin role을 디스코드 권한에 맞춰 동기화한다.
 * discordId가 새로 연결/변경되는 경로(유저등록·디코연동 등)에서 호출해
 * 권한 캐시(role)가 어긋나지 않게 한다.
 *
 * - 본캐(primaryPuuid=null) 행만 대상, outsider는 건드리지 않음
 * - 봇 계정은 절대 admin으로 승격하지 않음 (봇이 Administrator를 가진 경우가 많아 오승격 방지)
 *
 * @param {import('discord.js').GuildMember} member - 연결된 디스코드 멤버
 * @param {Object} group - DB group 레코드 (id 필요)
 * @returns {Promise<'promoted'|'demoted'|null>}
 */
async function syncUserAdminRole(member, group) {
  if (!member || !group) return null;

  const user = await models.user.findOne({
    where: { groupId: group.id, discordId: member.id, primaryPuuid: null },
    attributes: ['puuid', 'role'],
  });
  if (!user || user.role === 'outsider') return null;

  const shouldBeAdmin = isDiscordAdmin(member);
  const isAdmin = user.role === 'admin';

  if (shouldBeAdmin && !isAdmin) {
    await models.user.update({ role: 'admin' }, { where: { groupId: group.id, puuid: user.puuid } });
    logger.info(`권한 동기화: admin 승격 - ${member.user.tag} (그룹 ${group.id})`);
    return 'promoted';
  }
  if (!shouldBeAdmin && isAdmin) {
    await models.user.update({ role: 'member' }, { where: { groupId: group.id, puuid: user.puuid } });
    logger.info(`권한 동기화: member 강등 - ${member.user.tag} (그룹 ${group.id})`);
    return 'demoted';
  }
  return null;
}

module.exports = { isDiscordAdmin, syncUserAdminRole };
