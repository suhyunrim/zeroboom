const { Router } = require('express');
const models = require('../../db/models');

const summonerController = require('../../controller/summoner');

const route = Router();

module.exports = (app) => {
  app.use('/user', route);

  route.post('/register', async (req, res) => {
    const groupName = req.body.groupName;
    if (!groupName)
      return res.json({ result: "invalid group name" });
    
    const summonerName = req.body.summonerName;
    if (!summonerName)
      return res.json({ result: "invalid summoner name" });

    const group = await models.group.findOne({ where: { groupName } });
    if (!group)
      return res.json({ result: "group is not exist" });

    const summonerResult = await summonerController.getSummonerByName(summonerName);
    if (summonerResult.status != 200)
      return res.json(summonerResult.result).status(summonerResult.status);

    const summoner = summonerResult.result;

    await models.user.create({
        riotId: summoner.riotId,
        groupId: group.id,
        rating: 500,
      });

    return res.json({ result: "succeed" }).status(200);
  });
};
