const jwt = require('jsonwebtoken');
const axios = require('axios');
const config = require('../../config');
const models = require('../../db/models');
const { logger } = require('../../loaders/logger');

const DISCORD_API = 'https://discord.com/api/v10';
const ADMINISTRATOR = 0x8;

/**
 * JWT 토큰 검증 미들웨어
 * req.user에 디코딩된 유저 정보를 설정
 */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ result: '인증이 필요합니다.' });
  }

  try {
    const token = authHeader.split(' ')[1];
    req.user = jwt.verify(token, config.jwtSecret);
    return next();
  } catch (e) {
    return res.status(401).json({ result: '유효하지 않은 토큰입니다.' });
  }
};

/**
 * 그룹 관리자 권한 확인 미들웨어
 * Bot API로 해당 Discord 서버에서 실제 ADMINISTRATOR 권한이 있는지 실시간 검증
 */
const requireGroupAdmin = async (req, res, next) => {
  const groupId = Number(req.params.groupId || req.body.groupId);
  const { discordId } = req.user;

  if (!groupId || !discordId) {
    return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
  }

  try {
    const group = await models.group.findByPk(groupId, {
      attributes: ['discordGuildId'],
    });
    if (!group || !group.discordGuildId) {
      return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
    }

    // 서버 소유자는 역할과 무관하게 모든 권한 보유
    const guildRes = await axios.get(
      `${DISCORD_API}/guilds/${group.discordGuildId}`,
      { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } },
    );
    if (guildRes.data.owner_id === discordId) {
      return next();
    }

    const memberRes = await axios.get(
      `${DISCORD_API}/guilds/${group.discordGuildId}/members/${discordId}`,
      { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } },
    );

    const permissions = Number(memberRes.data.roles.length > 0
      ? await getComputedPermissions(group.discordGuildId, memberRes.data)
      : 0);

    if ((permissions & ADMINISTRATOR) !== ADMINISTRATOR) {
      return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
    }

    return next();
  } catch (e) {
    logger.error('Discord 권한 확인 에러:', e.response?.data || e.message);
    return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
  }
};

/**
 * 길드 역할 목록에서 멤버의 permissions 합산
 */
async function getComputedPermissions(guildId, member) {
  const rolesRes = await axios.get(
    `${DISCORD_API}/guilds/${guildId}/roles`,
    { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } },
  );
  const guildRoles = rolesRes.data;

  let permissions = 0;
  // @everyone 역할 (id === guildId)
  const everyoneRole = guildRoles.find((r) => r.id === guildId);
  if (everyoneRole) permissions |= Number(everyoneRole.permissions);

  // 멤버가 가진 역할들의 permissions OR 합산
  for (const roleId of member.roles) {
    const role = guildRoles.find((r) => r.id === roleId);
    if (role) permissions |= Number(role.permissions);
  }

  return permissions;
}

module.exports = { verifyToken, requireGroupAdmin };
