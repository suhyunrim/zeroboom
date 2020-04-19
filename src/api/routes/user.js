const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const models = require('../../db/models');

const summonerController = require('../../controller/summoner');

const route = Router();

const tierNames = {'IRON': 400, 'BRONZE': 400, 'SILVER': 400, 'GOLD': 500, 'PLATINUM': 600, 'DIAMOND': 700, 'UNRANKED': 500};
const tierSteps = ['IV', 'III', 'II', 'I'];

const convertAbbreviationTier = (tier) => {
  if (tier.length > 2)
    return tier;

  let result = '';
  const firstLetter = tier.charAt(0).toUpperCase();
  for (const tierName of Object.keys(tierNames))
  {
    if (firstLetter.startsWith(tierName.charAt(0)))
    {
      result = tierName;
      break;
    }
  }

  result += ' ';

  const secondLetter = Number(tier.charAt(1));
  result += tierSteps[tierSteps.length - secondLetter];

  return result;
}

const isValidTier = (tier) => {
  const split = tier.split(' ');
  const tierName = split[0].toUpperCase();
  const tierStep = split[1].toUpperCase();
  return tierNames[tierName] && tierSteps.indexOf(tierStep) != -1;
}

const getRating = (tier) => {
  if (!isValidTier(tier))
    return 400;

  const split = tier.split(' ');
  const tierName = split[0].toUpperCase();
  const rating = tierNames[tierName];
  const tierStep = split[1].toUpperCase();
  const tierMultiplier = tierSteps.indexOf(tierStep);
  return rating + tierMultiplier * 25;
};

module.exports = (app) => {
  app.use('/user', route);

  route.post('/register', async (req, res) => {
    const { groupName, summonerName, tokenId } = req.body;
    let { tier } = req.body;

    if (!groupName)
      return res.json({ result: 'invalid group name' });
    
    if (!summonerName)
      return res.json({ result: 'invalid summoner name' });

    const group = await models.group.findOne({ where: { groupName } });
    if (!group)
      return res.json({ result: 'group is not exist' });

    if (tier)
      tier = convertAbbreviationTier(tier);

    if (tier && !isValidTier(tier))
      return res.json({ result: 'invalid tier' });

    const summonerResult = await summonerController.getSummonerByName(summonerName);
    if (summonerResult.status != 200)
      return res.json(summonerResult.result).status(summonerResult.status);

    const summoner = summonerResult.result;
    if (!tier && (summoner.rankTier == 'UNRANKED' || (summoner.rankWin + summoner.rankLose) < 100))
      return res.json({ result: 'enter the tier explicitly'})

    const accountId = await summonerController.getAccountIdByName(tokenId, summonerName);
    if (!accountId)
      return res.json({ result: 'invalid token id' });
      
    models.summoner.update( { accountId: accountId }, { where: { name:summonerName } });

    try {
      await models.user.create({
        riotId: summoner.riotId,
        accountId: accountId,
        encryptedAccountId: summoner.encryptedAccountId,
        groupId: group.id,
        defaultRating: getRating(tier ? tier : summoner.rankTier)
      });
    } catch (e) {
      logger.error(e.stack);
      return res.json({ result: e.message }).status(501);
    }

    return res.json({ result: 'succeed' }).status(200);
  });
};
