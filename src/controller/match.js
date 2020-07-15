const models = require('../db/models');
const { Op } = require('sequelize');

const summonerController = require('../controller/summoner');

const elo = require('arpad');
const {
  getSummonerByName_V1,
  getCustomGameHistory,
  getMatchData,
} = require('../services/riot-api');
const { logger } = require('../loaders/logger');

const ratingCalculator = new elo();
const matchMaker = require('../match-maker/match-maker');
const User = require('../entity/user').User;

module.exports.registerMatch = async (tokenId, summonerName) => {
  if (!tokenId) return { result: 'invalid token id' };

  if (!summonerName) return { result: 'invalid summoner name' };

  const summoner = await getSummonerByName_V1(tokenId, summonerName);
  if (!summoner) return { result: 'invalid summoner' };

  const matches = await getCustomGameHistory(tokenId, summoner.accountId);
  for (let gameId of matches) {
    if (await models.match.findOne({ where: { gameId: gameId } })) continue;

    const matchData = await getMatchData(tokenId, gameId);
    if (!matchData) continue;

    try {
      await models.match.create(matchData);
    } catch (e) {
      logger.error(e.stack);
      return { result: e.message, statusCode: 501 };
    }
  }

  return { result: 'succeed', statusCode: 200 };
};

module.exports.predictWinRate = async (groupName, team1, team2) => {
  const group = await models.group.findOne({ where: { groupName: groupName } });

  const getRating = async (summonerName) => {
    const summoner = await models.summoner.findOne({
      where: { name: summonerName },
    });
    const user = await models.user.findOne({
      where: {
        groupId: group.id,
        riotId: summoner.riotId,
      },
    });
    return user.defaultRating + user.additionalRating;
  };

  let team1RatingMap = {};
  for (const summonerName of team1)
    team1RatingMap[summonerName] = await getRating(summonerName);

  let team2RatingMap = {};
  for (const summonerName of team2)
    team2RatingMap[summonerName] = await getRating(summonerName);

  const team1Rating = Object.values(team1RatingMap).reduce((total, current) => total + current) / 5;
  const team2Rating = Object.values(team2RatingMap).reduce((total, current) => total + current) / 5;
  const winRate = ratingCalculator.expectedScore(team1Rating, team2Rating);
  return { result: {winRate: winRate, team1: team1RatingMap, team2: team2RatingMap, team1Rating: team1Rating, team2Rating: team2Rating}, statusCode: 200 };
};

module.exports.generateMatch = async (
  groupName,
  team1Names,
  team2Names,
  userPool,
  matchCount,
) => {
  const group = await models.group.findOne({ where: { groupName: groupName } });

  let summoners = {};

  const getUserModel = async (summonerName) => {
    const { result } = await summonerController.getSummonerByName(summonerName);

    if (!result) {
      logger.error(`db error ${summonerName} not found`);
      return;
    }

    if (!summoners[result.riotId]) summoners[result.riotId] = result;

    return (userModel = await models.user.findOne({
      where: {
        groupId: group.id,
        riotId: result.riotId,
      },
    }));
  };

  const applyTeam = async (teamArray, summonerNames) => {
    for (const name of summonerNames) {
      const userModel = await getUserModel(name);
      if (!userModel) {
        logger.error(`db error ${name} not found`);
        return;
      }
      let user = new User();
      user.setFromUserModel(userModel);
      teamArray.push(user);
    }
  };

  let preOrganizationTeam1 = [];
  await applyTeam(preOrganizationTeam1, team1Names);

  let preOrganizationTeam2 = [];
  await applyTeam(preOrganizationTeam2, team2Names);

  let makerUserPool = [];
  await applyTeam(makerUserPool, userPool);

  const matchingGames = matchMaker.matchMake(
    preOrganizationTeam1,
    preOrganizationTeam2,
    makerUserPool,
    matchCount,
  );
  if (matchingGames == null) {
    logger.error('invalid params');
    return;
  }

  let result = [];
  for (const match of matchingGames) {
    result.push({
      team1: match.team1.map((elem) => summoners[elem.id].name),
      team2: match.team2.map((elem) => summoners[elem.id].name),
      team1WinRate: match.winRate,
    });
  }

  return { result: result, statusCode: 200 };
};

module.exports.calculateRating = async (groupName) => {
  if (!groupName) return { result: 'invalid group name' };

  const group = await models.group.findOne({ where: { groupName: groupName } });
  if (!group) return { result: 'group is not exist' };

  const matches = await models.match.findAll({
    where: {
      [Op.or]: [{ groupId: null }, { groupId: group.id }],
    },
  });

  if (matches.length == 0) return { result: 'there is no match' };

  matches.sort((a, b) => a.gameCreation > b.gameCreation);

  let summoners = {};
  let users = {};
  let unknownSummoners = {};
  let unknownUsers = {};
  let expectationGroup = {};

  const getUser = async (accountId, name) => {
    if (unknownSummoners[accountId]) {
      unknownSummoners[accountId] = name;
      return;
    }

    let summoner = summoners[accountId];
    if (!summoner)
      summoner = await models.summoner.findOne({
        where: { accountId: accountId },
      });

    if (!summoner) {
      summoner = await models.summoner.findOne({ where: { name: name } });
      if (summoner) {
        await models.summoner.update(
          { accountId: accountId },
          { where: { name: name } },
        );
      }
    }

    if (!summoner) {
      unknownSummoners[accountId] = name;
      return;
    }

    let user = users[summoner.riotId];
    if (!user) {
      user = await models.user.findOne({
        where: {
          [Op.and]: [{ riotId: summoner.riotId }, { groupId: group.id }],
        },
      });

      if (user) {
        user.win = 0;
        user.lose = 0;
        user.additionalRating = 0;
        user.accountId = accountId;
      }
    }

    if (!user) {
      unknownUsers[summoner.riotId] = summoner.name;
      return;
    }

    summoners[accountId] = summoner;
    users[summoner.riotId] = user;

    return user;
  };

  const getTeam = async (teamData) => {
    let ret = [];
    for (const pair of teamData) {
      let user = await getUser(pair[0], pair[1]);
      if (user) ret.push(user);
    }
    return ret;
  };

  const apply = (team, isWon, ratingDelta) => {
    team.forEach((elem) => {
      if (isWon) elem.win++;
      else elem.lose++;

      elem.additionalRating += ratingDelta;
      users[elem.accountId] = elem;
    });
  };

  const reducer = (total, user) => {
    total += user.defaultRating + user.additionalRating;
    return total;
  };

  const groupBy = (list, keyGetter) => {
    const map = new Map();
    list.forEach((item) => {
      const key = keyGetter(item);
      const collection = map.get(key);
      if (!collection) {
        map.set(key, [item]);
      } else {
        collection.push(item);
      }
    });
    return map;
  };

  for (const match of matches) {
    let team1 = await getTeam(match.team1);
    let team2 = await getTeam(match.team2);

    if (team1.length + team2.length < 7) continue;
    else if (team1.length + team2.length < 10) {
      const existUserArray = team1.concat(team2);
      const usersByGroupId = groupBy(existUserArray, (elem) => elem.groupId);
      for (let pair of usersByGroupId) {
        const groupIds = pair[1];
        if (groupIds.length >= 6) {
          const expectationGroupId = existUserArray[0].groupId;
          if (!expectationGroup[expectationGroupId])
            expectationGroup[expectationGroupId] = {};

          const riotTeamData = match.team1.concat(match.team2);
          riotTeamData.forEach((elem) => {
            if (
              existUserArray.findIndex((user) => user.accountId == elem[0]) ==
              -1
            ) {
              expectationGroup[expectationGroupId][elem[0]] = elem[1];
            }
          });
        }
      }
      continue;
    }

    match.update({ groupId: group.id });

    const team1Rating = team1.reduce(reducer, 0) / 5;
    const team2Rating = team2.reduce(reducer, 0) / 5;

    let team1Delta,
      team2Delta = 0;
    if (match.winTeam == 1) {
      team1Delta =
        ratingCalculator.newRatingIfWon(team1Rating, team2Rating) - team1Rating;
      team2Delta =
        ratingCalculator.newRatingIfLost(team2Rating, team1Rating) -
        team2Rating;
    } else {
      team1Delta =
        ratingCalculator.newRatingIfLost(team1Rating, team2Rating) -
        team1Rating;
      team2Delta =
        ratingCalculator.newRatingIfWon(team2Rating, team1Rating) - team2Rating;
    }

    apply(team1, match.winTeam == 1, team1Delta);
    apply(team2, match.winTeam == 2, team2Delta);
  }

  Object.entries(users).forEach(([k, v]) => v.update(v.dataValues));

  if (
    Object.keys(unknownSummoners).length > 0 ||
    Object.keys(unknownUsers).length > 0 ||
    Object.keys(expectationGroup).length > 0
  ) {
    return {
      result: 'unknown users are exist',
      unknownSummoners: JSON.stringify(unknownSummoners),
      unknownUsers: JSON.stringify(unknownUsers),
      expectationGroup: JSON.stringify(expectationGroup),
    };
  }

  return { result: 'succeed' };
};
