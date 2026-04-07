const { Router } = require('express');
const models = require('../../db/models');
const { definitions } = require('../../services/achievement/definitions');

const route = Router();

module.exports = (app) => {
  app.use('/achievement', route);

  route.get('/:groupId/:puuid', async (req, res) => {
    const { groupId, puuid } = req.params;

    const unlocked = await models.user_achievement.findAll({
      where: { groupId: Number(groupId), puuid },
      attributes: ['achievementId', 'unlockedAt'],
    });
    const unlockedMap = {};
    unlocked.forEach((u) => { unlockedMap[u.achievementId] = u.unlockedAt; });

    const result = definitions.map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      emoji: def.emoji,
      tier: def.tier,
      category: def.category,
      unlocked: !!unlockedMap[def.id],
      unlockedAt: unlockedMap[def.id] || null,
    }));

    return res.status(200).json({ result });
  });
};
