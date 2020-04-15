const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const models = require('../../db/models');

const { getSummonerByName_V1, getCustomGameHistory, getMatchData } = require('../../services/riot-api');

const route = Router();

module.exports = (app) => {
  app.use('/match', route);

  route.post('/register', async (req, res) => {
    const { tokenId, summonerName } = req.body;

    if (!tokenId)
      return res.json({ result: "invalid token id" });
    
    if (!summonerName)
      return res.json({ result: "invalid summoner name" });

    const summoner = await getSummonerByName_V1(tokenId, summonerName);
    if (!summoner)
      return res.json({ result: "invalid summoner" });

    const matches = await getCustomGameHistory(tokenId, summoner.accountId);
    for (let gameId of matches)
    {
      const matchData = await getMatchData(tokenId, gameId);
      try {
        await models.match.findOrCreate({
          where: {
            gameId: matchData.gameId,
          }, defaults: matchData});
      } catch (e) {
        logger.error(e.stack);
        res.json({ result: e.message }).status(501);
      }
    }

    return res.json({ result: "succeed" }).status(200);
  });
};
