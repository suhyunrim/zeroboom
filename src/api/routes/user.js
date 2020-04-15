const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const models = require('../../db/models');

const summonerController = require('../../controller/summoner');

const route = Router();

module.exports = (app) => {
  app.use('/user', route);

  route.post('/register', async (req, res) => {
    const { groupName, summonerName } = req.body;

    if (!groupName)
      return res.json({ result: "invalid group name" });
    
    if (!summonerName)
      return res.json({ result: "invalid summoner name" });

    const group = await models.group.findOne({ where: { groupName } });
    if (!group)
      return res.json({ result: "group is not exist" });

    const summonerResult = await summonerController.getSummonerByName(summonerName);
    if (summonerResult.status != 200)
      return res.json(summonerResult.result).status(summonerResult.status);

    const summoner = summonerResult.result;

    try {
      await models.user.create({
        riotId: summoner.riotId,
        groupId: group.id,
        rating: 500,
      });
    } catch (e) {
      logger.error(e.stack);
        return res.json({ result: e.message }).status(501);
    }

    return res.json({ result: "succeed" }).status(200);
  });
};
