const models = require('../db/models');
const { getSummonerByName_V1, getCustomGameHistory, getMatchData } = require('../services/riot-api');
const { logger } = require('../loaders/logger');

module.exports.registerMatch = async (tokenId, summonerName) => {
    if (!tokenId)
      return { result: "invalid token id" };
    
    if (!summonerName)
      return { result: "invalid summoner name" };

    const summoner = await getSummonerByName_V1(tokenId, summonerName);
    if (!summoner)
      return { result: "invalid summoner" };

    const matches = await getCustomGameHistory(tokenId, summoner.accountId);
    for (let gameId of matches)
    {
      if (await models.match.findOne({ where: { gameId: gameId } }))
        continue;

      const matchData = await getMatchData(tokenId, gameId);
      if (!matchData)
        continue;

      try {
        await models.match.create(matchData);
      } catch (e) {
        logger.error(e.stack);
        return { result: e.message, statusCode: 501 };
      }
    }

    return { result: "succeed", statusCode: 200 };
};