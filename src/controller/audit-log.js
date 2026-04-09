const { Op } = require('sequelize');
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
 * @param {number} groupId
 * @param {Object} options
 * @param {number} [options.page=1]
 * @param {number} [options.limit=50]
 * @param {string} [options.action] - 액션 필터
 * @param {string} [options.startDate] - 시작일 (ISO 형식)
 * @param {string} [options.endDate] - 종료일 (ISO 형식)
 */
module.exports.getByGroupId = async (groupId, { page = 1, limit = 50, action, startDate, endDate } = {}) => {
  const where = { groupId };
  if (action) where.action = action;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt[Op.gte] = new Date(startDate);
    if (endDate) where.createdAt[Op.lte] = new Date(endDate);
  }

  const offset = (page - 1) * limit;
  const { count, rows } = await models.audit_log.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset,
    limit,
  });

  return { total: count, page, limit, logs: rows };
};
