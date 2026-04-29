const models = require('../db/models');
const auditLog = require('./audit-log');
const notificationController = require('./notification');
const { logger } = require('../loaders/logger');

/**
 * 시즌 초기화
 * - 현재 시즌 유저 스냅샷 저장
 * - additionalRating 소프트 리셋 (반감)
 * - currentSeason 증가
 */
module.exports.resetSeason = async (groupId, actorDiscordId, actorName) => {
  const t = await models.sequelize.transaction();
  try {
    const group = await models.group.findByPk(groupId, { transaction: t });
    const settings = group.settings || {};
    const currentSeason = settings.currentSeason || 1;

    // 모든 유저 스냅샷 저장
    const users = await models.user.findAll({
      where: { groupId },
      transaction: t,
    });

    const snapshots = users.map((u) => ({
      groupId,
      puuid: u.puuid,
      season: currentSeason,
      defaultRating: u.defaultRating,
      additionalRating: u.additionalRating,
      discordId: u.discordId,
    }));
    await models.season_snapshot.bulkCreate(snapshots, { transaction: t });

    // additionalRating 소프트 리셋 (일괄 SQL)
    await models.sequelize.query('UPDATE users SET additionalRating = FLOOR(additionalRating / 2) WHERE groupId = ?', {
      replacements: [groupId],
      transaction: t,
    });

    // currentSeason 증가
    const newSeason = currentSeason + 1;
    await group.update({ settings: { ...settings, currentSeason: newSeason } }, { transaction: t });

    await t.commit();

    // 감사 로그 (트랜잭션 밖)
    auditLog.log({
      groupId,
      actorDiscordId,
      actorName,
      action: 'season.reset',
      details: { fromSeason: currentSeason, toSeason: newSeason, usersAffected: users.length },
      source: 'discord',
    });

    // 시즌 종료 알림 발송 (전 유저, 최종 레이팅 + 순위 포함)
    try {
      const ranked = users
        .filter((u) => u.role !== 'outsider' && u.discordId)
        .map((u) => ({
          discordId: u.discordId,
          puuid: u.puuid,
          totalRating: (u.defaultRating || 0) + (u.additionalRating || 0),
        }))
        .sort((a, b) => b.totalRating - a.totalRating);
      // 같은 discordId(본캐/부캐)는 첫 등장만 사용
      const seen = new Set();
      const dedup = ranked.filter((e) => {
        if (seen.has(e.discordId)) return false;
        seen.add(e.discordId);
        return true;
      });
      const rows = dedup.map((e, i) => ({
        recipientDiscordId: e.discordId,
        groupId,
        type: 'season_end',
        targetKey: `season:${groupId}:${currentSeason}`,
        payload: {
          fromSeason: currentSeason,
          toSeason: newSeason,
          finalRank: i + 1,
          finalRating: e.totalRating,
          totalParticipants: dedup.length,
        },
      }));
      await notificationController.createMany(rows);
    } catch (e) {
      logger.error(`[시즌] 종료 알림 발송 실패 (groupId=${groupId}): ${e.message}`);
    }

    return { fromSeason: currentSeason, toSeason: newSeason, usersAffected: users.length };
  } catch (err) {
    await t.rollback();
    throw err;
  }
};
