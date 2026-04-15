const models = require('../db/models');
const auditLog = require('./audit-log');

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
      win: u.win,
      lose: u.lose,
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

    return { fromSeason: currentSeason, toSeason: newSeason, usersAffected: users.length };
  } catch (err) {
    await t.rollback();
    throw err;
  }
};
