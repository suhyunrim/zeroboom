const models = require('../db/models');
const elo = require('arpad');
const { getSummonerByName_V1, getCustomGameHistory, getMatchData } = require('../services/riot-api');
const { logger } = require('../loaders/logger');

const ratingCalculator = new elo();
const matchMaker = require('../match-maker/match-maker');

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

module.exports.predictWinRate = async (groupName, team1, team2) => {
  const group = await models.group.findOne({ where: { groupName: groupName } });

  const getRating = async (summonerName) => {
    const summoner = await models.summoner.findOne({ where: { name: summonerName } });
    const user = await models.user.findOne({
      where: {
        groupId: group.id,
        riotId: summoner.riotId
      }})
    return user.defaultRating + user.additionalRating;
  }

  let team1Rating = 0;
  for (const summonerName of team1)
    team1Rating += await getRating(summonerName);
  team1Rating /= 5;

  let team2Rating = 0;
  for (const summonerName of team2)
    team2Rating += await getRating(summonerName);
  team2Rating /= 5;

  const winRate = ratingCalculator.expectedScore(team1Rating, team2Rating);
  return { result: winRate, statusCode: 200 };
};

module.exports.generateMatch = async (groupName, team1Names, team2Names, userPool) => {
  const group = await models.group.findOne({ where: { groupName: groupName } });

  let summoners = {};

  const getUser = async (summonerName) => {
    const summoner = await models.summoner.findOne({ where: { name: summonerName } });
    if (!summoners[summoner.riotId])
      summoners[summoner.riotId] = summoner;

    return user = await models.user.findOne({
      where: {
        groupId: group.id,
        riotId: summoner.riotId
      }});
  }

  const applyTeam = async (teamArray, summonerNames) => {
    for (const name of summonerNames)
    {
      const user = await getUser(name);
      teamArray.push(new matchMaker.User(user.riotId, user.defaultRating + user.additionalRating));
    }
  }

  let preOrganizationTeam1 = [];
  await applyTeam(preOrganizationTeam1, team1Names);

  let preOrganizationTeam2 = [];
  await applyTeam(preOrganizationTeam2, team2Names);

  let makerUserPool = [];
  await applyTeam(makerUserPool, userPool);

  const matchingGames = matchMaker.matchMake(preOrganizationTeam1, preOrganizationTeam2, makerUserPool, 5);
  if (matchingGames == null)
  {
    logger.error("invalid params");
    return;
  }

  let result = [];
  for (const match of matchingGames)
  {
    result.push({
      team1:match.team1.map(elem => summoners[elem.id].name),
      team2:match.team2.map(elem => summoners[elem.id].name),
      team1WinRate:match.winRate
    });
  }

  return { result: result, statusCode: 200};
};