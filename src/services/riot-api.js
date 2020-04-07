const riotAPI = require('sample-node-package');

const getSummonerByName = async (summonerName) => {
  const result = await riotAPI.summoner.getByName(summonerName)();

  if (result.status !== 200)
    throw new Error(
      `riotAPI.summoner.getByName(${summonerName}) => ${result.status}`,
    );

  return result.data;
};

exports.getSummonerByName = getSummonerByName;

const getEntriesBySummonerId = async (summonerId) => {
  const result = await riotAPI.league.getEntriesBySummonerId(summonerId)();

  return result;
};

exports.getEntriesBySummonerId = getEntriesBySummonerId;
