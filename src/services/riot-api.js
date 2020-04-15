const riotAPI = require('sample-node-package');

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

const getEntriesBySummonerId = async (summonerId) => {
  const result = await riotAPI.v4.league.getEntriesBySummonerId(summonerId)();

  return result;
};

exports.getEntriesBySummonerId = getEntriesBySummonerId;


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
  let beginIndex = 0
  let isFinished = false;
  //until = until ? until : Date.now() - 86400 * 30 * 3 * 1000;
  until = until ? until : Date.now() - 86400 * 7 * 1000;
  while (!isFinished)
  {
    const result = await riotAPI.v1.match.getMatchHistory(tokenId, accountId, beginIndex)();
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

  return customGames;
}

exports.getCustomGameHistory = getCustomGameHistory

const getMatchData = async (tokenId, gameId) => {
  const result = await riotAPI.v1.match.getMatchData(tokenId, gameId)();

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
      if (participantData.teamId == 100)
      {
        matchData.team1.push(identity.player.accountId);
      }
      else
      {
        matchData.team2.push(identity.player.accountId);
      }
    }
  });

  return matchData;
}

exports.getMatchData = getMatchData;