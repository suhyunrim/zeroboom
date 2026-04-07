const { Router } = require('express');
const models = require('../../db/models');
const { definitions } = require('../../services/achievement/definitions');

const route = Router();

module.exports = (app) => {
  app.use('/achievement', route);

  route.get('/:groupId/:puuid', async (req, res) => {
    const { groupId, puuid } = req.params;

    const gid = Number(groupId);
    const [unlocked, totalUsers, achievementCounts] = await Promise.all([
      models.user_achievement.findAll({
        where: { groupId: gid, puuid },
        attributes: ['achievementId', 'unlockedAt'],
      }),
      models.user.count({ where: { groupId: gid } }),
      models.user_achievement.findAll({
        where: { groupId: gid },
        attributes: ['achievementId', [models.sequelize.fn('COUNT', models.sequelize.col('achievementId')), 'cnt']],
        group: ['achievementId'],
        raw: true,
      }),
    ]);

    const unlockedMap = {};
    unlocked.forEach((u) => { unlockedMap[u.achievementId] = u.unlockedAt; });
    const countMap = {};
    achievementCounts.forEach((r) => { countMap[r.achievementId] = Number(r.cnt); });

    const result = definitions.map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      emoji: def.emoji,
      tier: def.tier,
      category: def.category,
      unlocked: !!unlockedMap[def.id],
      unlockedAt: unlockedMap[def.id] || null,
      achievementRate: totalUsers > 0 ? Math.round(((countMap[def.id] || 0) / totalUsers) * 1000) / 10 : 0,
    }));

    return res.status(200).json({ result });
  });
};
