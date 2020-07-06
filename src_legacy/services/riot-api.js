const { logger } = require('../loaders/logger');

const riotAPI = require('tristana');

/// V4
const getSummonerByName = async (summonerName) => {
  const result = await riotAPI.v4.summoner.getByName(summonerName)();

  if (result.status !== 200)
    throw new Error(
      `riotAPI.v4.summoner.getByName(${summonerName}) => ${result.status}`,
    );

  return result.data;
};

exports.getSummonerByName = getSummonerByName;

const getRankDataBySummonerId = async (summonerId) => {
  const result = await riotAPI.v4.league.getEntriesBySummonerId(summonerId)();

  if (result.status !== 200)
    throw new Error(
      `riotAPI.v4.league.getEntriesBySummonerId(${summonerId}) => ${result.status}`,
    );

  return result.data;
};

exports.getRankDataBySummonerId = getRankDataBySummonerId;


/// V1
const getSummonerByName_V1 = async (tokenId, summonerName) => {
  const result = await riotAPI.v1.summoner.getByName(tokenId, summonerName)();

  if (result.status !== 200)
    throw new Error(
      `riotAPI.v1.summoner.getByName(${summonerName}) => ${result.status}`,
    );

  return result.data;
}

exports.getSummonerByName_V1 = getSummonerByName_V1;

const getCustomGameHistory = async (tokenId, accountId, until) => {
  let customGames = [];
  
  try {
    let beginIndex = 0
    let isFinished = false;
    until = until ? until : Date.now() - 86400 * 30 * 3 * 1000;
    while (!isFinished)
    {
      const result = await riotAPI.v1.match.getMatchHistory(tokenId, accountId, beginIndex)();
      if (result.status != 200)
        throw new Error(
          `riotAPI.v1.match.getMatchHistory(${accountId}) => ${result.status}`,
        );

      result.data.games.games.forEach(element => {
        if (element.gameCreation < until)
        {
          isFinished = true;
          return;
        }

        if (element.gameMode == 'CLASSIC' && element.gameType == 'CUSTOM_GAME' && element.mapId == 11)
        {
          customGames.push(element.gameId);
        }
      });

      beginIndex += 20;
    }
  } catch (e) {
    logger.error(e.stack);
    logger.error(`riotAPI.v1.match.getMatchHistory(${accountId})`);
  }

  return customGames;
}

exports.getCustomGameHistory = getCustomGameHistory

const getMatchData = async (tokenId, gameId) => {
  try {
    const result = await riotAPI.v1.match.getMatchData(tokenId, gameId)();
    if (result.status != 200)
      throw new Error(
        `riotAPI.v1.match.getMatchData(${gameId}) => ${result.status}`,
      );
  
    const data = result.data;
    let matchData = {
      gameId: data.gameId,
      gameCreation: new Date(data.gameCreation),
      winTeam: data.teams[0].win == 'Win' ? 1 : 2,
      team1: [],
      team2: []
    }

    data.participantIdentities.forEach((identity) => {
      const participantData = data.participants.find(elem => elem.participantId == identity.participantId);
      if (participantData)
      {
        const team = participantData.teamId == 100 ? matchData.team1 : matchData.team2;
        team.push([ identity.player.accountId, identity.player.summonerName ]);
      }
    });

    return matchData;
  } catch (e) {
    logger.error(e.stack);
    logger.error(`riotAPI.v1.match.getMatchData(${gameId})`);
  }
}

exports.getMatchData = getMatchData;