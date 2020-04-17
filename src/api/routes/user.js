const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const models = require('../../db/models');

const summonerController = require('../../controller/summoner');

const route = Router();

const tierNames = {'IRON': 400, 'BRONZE': 400, 'SILVER': 400, 'GOLD': 500, 'PLATINUM': 500, 'DIAMOND': 600, 'UNRANKED': 500};
const tierSteps = ['IV', 'III', 'II', 'I'];

const isValidTier = (tier) => {
  const split = tier.split(' ');
  const tierName = split[0].toUpperCase();
  const tierStep = split[1].toUpperCase();
  return tierNames[tierName] && tierSteps.indexOf(tierStep) != -1;
}

const getRating = (tier) => {
  if (isValidTier(tier))
    return 400;

  const split = tier.split(' ');
  const tierName = split[0].toLowerCase();
  const rating = tierNames[tierName];
  const tierMultiplier = tierSteps.findIndex(split[1]) + 1;
  return rating + tierMultiplier * 25;
};

module.exports = (app) => {
  app.use('/user', route);

  route.post('/register', async (req, res) => {
    const { groupName, summonerName, tier } = req.body;

    if (!groupName)
      return res.json({ result: 'invalid group name' });
    
    if (!summonerName)
      return res.json({ result: 'invalid summoner name' });

    const group = await models.group.findOne({ where: { groupName } });
    if (!group)
      return res.json({ result: 'group is not exist' });

    if (tier && !isValidTier(tier))
      return res.json({ result: 'invalid tier' });

    const summonerResult = await summonerController.getSummonerByName(summonerName);
    if (summonerResult.status != 200)
      return res.json(summonerResult.result).status(summonerResult.status);

    const summoner = summonerResult.result;
    if (!tier && (summoner.rankTier == 'UNRANKED' || (summoner.rankWin + summoner.rankLose) < 100))
      return res.json({ result: 'enter the tier explicitly'})

    try {
      await models.user.create({
        riotId: summoner.riotId,
        groupId: group.id,
        rating: getRating(tier ? tier : summoner.rankTier)
      });
    } catch (e) {
      logger.error(e.stack);
      return res.json({ result: e.message }).status(501);
    }

    return res.json({ result: 'succeed' }).status(200);
  });
};
