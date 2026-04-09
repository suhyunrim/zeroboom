const models = require('../db/models');

/**
 * 감사 로그 기록
 * @param {Object} params
 * @param {number} params.groupId
 * @param {string} params.actorDiscordId
 * @param {string} [params.actorName]
 * @param {string} params.action - 예: 'match.confirm', 'user.kick'
 * @param {Object} [params.details] - 자유 형식 JSON
 * @param {'discord'|'web'} [params.source='discord']
 */
module.exports.log = async ({ groupId, actorDiscordId, actorName, action, details, source = 'discord' }) => {
  return models.audit_log.create({ groupId, actorDiscordId, actorName, action, details, source });
};

/**
 * 그룹별 감사 로그 조회
 */
module.exports.getByGroupId = async (groupId, { page = 1, limit = 50, action } = {}) => {
  const where = { groupId };
  if (action) where.action = action;

  const offset = (page - 1) * limit;
  const { count, rows } = await models.audit_log.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset,
    limit,
  });

  return { total: count, page, limit, logs: rows };
};
