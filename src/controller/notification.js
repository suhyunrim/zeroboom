const models = require('../db/models');
const { logger } = require('../loaders/logger');

const TEXT_PREVIEW_MAX = 50;
const LIST_FETCH_LIMIT = 200;
const ACTOR_SAMPLE_PER_GROUP = 3;

/**
 * 알림 한 건 생성. actor === recipient면 skip.
 * 실패해도 throw하지 않음 (호출 측 비즈니스 로직 보호).
 */
const create = async ({ recipientDiscordId, groupId, type, targetKey, actorDiscordId, actorName, payload }) => {
  if (!recipientDiscordId || !type) return null;
  if (actorDiscordId && actorDiscordId === recipientDiscordId) return null;
  try {
    return await models.notification.create({
      recipientDiscordId,
      groupId: groupId || null,
      type,
      targetKey: targetKey || null,
      actorDiscordId: actorDiscordId || null,
      actorName: actorName || null,
      payload: payload || null,
    });
  } catch (e) {
    logger.error('알림 생성 실패:', e);
    return null;
  }
};

/**
 * 다수 recipient에게 같은 알림 일괄 생성.
 * actor 자기 자신은 자동 skip.
 */
const createBulk = async ({ recipientDiscordIds, groupId, type, targetKey, actorDiscordId, actorName, payload }) => {
  if (!Array.isArray(recipientDiscordIds) || recipientDiscordIds.length === 0) return [];
  const filtered = recipientDiscordIds.filter((id) => id && id !== actorDiscordId);
  if (filtered.length === 0) return [];
  try {
    const rows = filtered.map((rid) => ({
      recipientDiscordId: rid,
      groupId: groupId || null,
      type,
      targetKey: targetKey || null,
      actorDiscordId: actorDiscordId || null,
      actorName: actorName || null,
      payload: payload || null,
    }));
    return await models.notification.bulkCreate(rows);
  } catch (e) {
    logger.error('알림 일괄 생성 실패:', e);
    return [];
  }
};

/**
 * 텍스트 미리보기 잘라내기 (방명록 댓글/답글용).
 */
const buildTextPreview = (text, max = TEXT_PREVIEW_MAX) => {
  if (!text) return '';
  const trimmed = String(text)
    .replace(/\s+/g, ' ')
    .trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
};

/**
 * 같은 (type, targetKey) 알림들을 하나의 그룹으로 묶기.
 * targetKey가 null인 알림은 묶지 않음(개별 row가 그룹 1개).
 *
 * 입력: 알림 row 배열 (createdAt DESC 정렬된 상태)
 * 출력: 그룹 배열 — { key, type, targetKey, groupId, latestAt, hasUnread, count, actors[], items[] }
 */
const groupNotifications = (rows) => {
  const groups = [];
  const indexByKey = new Map();

  rows.forEach((row) => {
    const groupKey = row.targetKey ? `${row.type}::${row.targetKey}` : `single::${row.id}`;
    let group = indexByKey.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        type: row.type,
        targetKey: row.targetKey || null,
        groupId: row.groupId || null,
        latestAt: row.createdAt,
        hasUnread: false,
        count: 0,
        actors: [],
        items: [],
      };
      indexByKey.set(groupKey, group);
      groups.push(group);
    }
    group.count += 1;
    group.items.push(row);
    if (!row.readAt) group.hasUnread = true;
    if (new Date(row.createdAt) > new Date(group.latestAt)) {
      group.latestAt = row.createdAt;
    }
    if (
      row.actorDiscordId &&
      group.actors.length < ACTOR_SAMPLE_PER_GROUP &&
      !group.actors.some((a) => a.discordId === row.actorDiscordId)
    ) {
      group.actors.push({ discordId: row.actorDiscordId, name: row.actorName || null });
    }
  });

  groups.sort((a, b) => new Date(b.latestAt) - new Date(a.latestAt));
  return groups;
};

/**
 * 내 알림 목록 (그룹화).
 */
const getList = async (recipientDiscordId, { limit = 50 } = {}) => {
  const rows = await models.notification.findAll({
    where: { recipientDiscordId },
    order: [['createdAt', 'DESC']],
    limit: LIST_FETCH_LIMIT,
  });
  const plain = rows.map((r) => r.get({ plain: true }));
  const groups = groupNotifications(plain);
  return groups.slice(0, limit);
};

/**
 * 미읽음 그룹 수 (인스타식 빨간 점).
 * 안 읽은 row만 가져와 그룹화 후 그 그룹 수를 카운트.
 */
const getUnreadGroupCount = async (recipientDiscordId) => {
  const rows = await models.notification.findAll({
    where: { recipientDiscordId, readAt: null },
    order: [['createdAt', 'DESC']],
    limit: LIST_FETCH_LIMIT,
  });
  const plain = rows.map((r) => r.get({ plain: true }));
  return groupNotifications(plain).length;
};

/**
 * 전체 일괄 읽음 처리.
 */
const markAllRead = async (recipientDiscordId) => {
  return models.notification.update({ readAt: new Date() }, { where: { recipientDiscordId, readAt: null } });
};

/**
 * 특정 그룹(type+targetKey) 읽음 처리. targetKey null이면 id 기준.
 */
const markGroupRead = async ({ recipientDiscordId, type, targetKey, id }) => {
  const where = { recipientDiscordId, readAt: null };
  if (targetKey) {
    where.type = type;
    where.targetKey = targetKey;
  } else if (id) {
    where.id = id;
  } else {
    return [0];
  }
  return models.notification.update({ readAt: new Date() }, { where });
};

module.exports = {
  create,
  createBulk,
  buildTextPreview,
  groupNotifications,
  getList,
  getUnreadGroupCount,
  markAllRead,
  markGroupRead,
  TEXT_PREVIEW_MAX,
};
