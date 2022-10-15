const models = require('../db/models');
const { Op } = require('sequelize');

const summonerController = require('../controller/summoner');

const elo = require('arpad');
const {
  getSummonerByName_V1,
  getCustomGames,
  getMatchData,
} = require('../services/riot-api');
const { logger } = require('../loaders/logger');

const ratingCalculator = new elo(16);
const matchMaker = require('../match-maker/match-maker');
const User = require('../entity/user').User;

module.exports.registerMatch = async (tokenId, summonerName) => {
  if (!tokenId) return { result: 'invalid token id' };
  if (!summonerName) return { result: 'invalid summoner name' };

  try {
    const summoner = await getSummonerByName_V1(tokenId, summonerName);
    if (!summoner) return { result: 'invalid summoner' };

    const accountId = summoner.accountId;
    const latestGameCreation = await models.latest_game_creation.findOne({
      where: { accountId },
      raw: true,
    });
    const until = latestGameCreation
      ? latestGameCreation.gameCreation
      : new Date(new Date().getFullYear(), 0);
    const matches = await getCustomGames(tokenId, accountId, until);
    const matchIds = matches.map((elem) => elem.gameId);
    const matchIdsInDB = (
      await models.match.findAll({
        where: { gameId: matchIds },
        raw: true,
      })
    ).map((elem) => Number(elem.gameId));

    let newLatestGameCreation = 0;
    for (const simpleMatchData of matches) {
      newLatestGameCreation =
        simpleMatchData.gameCreation >= newLatestGameCreation
          ? simpleMatchData.gameCreation
          : newLatestGameCreation;

      const gameId = simpleMatchData.gameId;
      if (matchIdsInDB.find((elem) => elem === gameId)) continue;

      const matchData = await getMatchData(tokenId, gameId);
      if (!matchData || matchData.team1.length + matchData.team2.length !== 10)
        continue;

      await models.match.create(matchData);
    }

    if (newLatestGameCreation !== 0) {
      await models.latest_game_creation.upsert({
        accountId,
        gameCreation: newLatestGameCreation + 1000, // 시간 보정을 위해 1초 추가함 (by ZeroBoom)
      });
    }
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }

  return { result: 'succeed', status: 200 };
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

  const team1Rating =
    Object.values(team1RatingMap).reduce((total, current) => total + current) /
    5;
  const team2Rating =
    Object.values(team2RatingMap).reduce((total, current) => total + current) /
    5;
  const winRate = ratingCalculator.expectedScore(team1Rating, team2Rating);
  return {
    result: {
      winRate: winRate,
      team1: team1RatingMap,
      team2: team2RatingMap,
      team1Rating: team1Rating,
      team2Rating: team2Rating,
    },
    status: 200,
  };
};

module.exports.generateMatch = async (
  groupName,
  team1Names,
  team2Names,
  userPool,
  matchCount,
) => {
  try {
    if (team1Names.length + team2Names.length + userPool.length !== 10) {
      throw '자동매칭에 필요한 유저 수는 10명입니다.';
    }

    const allNames = team1Names.concat(team2Names).concat(userPool);
    const duplicationNames = new Set();
    const exists = {};
    allNames.forEach((elem) => {
      if (exists[elem]) {
        duplicationNames.add(elem);
      } else {
        exists[elem] = true;
      }
    });

    if (duplicationNames.size >= 1) {
      let errorMessage = '';
      duplicationNames.forEach((elem) => {
        errorMessage = errorMessage + `[${elem}] `;
      });
      errorMessage += '가 중복입니다.';
      throw errorMessage;
    }

    const group = await models.group.findOne({
      where: { groupName: groupName },
    });

    let summoners = {};

    const getUserModel = async (summonerName) => {
      const result = await summonerController.getSummonerByName(summonerName);

      if (result.status !== 200) {
        throw `[${summonerName}]는 존재하지 않는 소환사입니다.`;
      }

      const summoner = result.result;
      if (!summoners[summoner.riotId]) {
        summoners[summoner.riotId] = summoner;
      }

      return await models.user.findOne({
        where: {
          groupId: group.id,
          riotId: summoner.riotId,
        },
      });
    };

    const applyTeam = async (teamArray, summonerNames) => {
      for (const name of summonerNames) {
        const userModel = await getUserModel(name);
        if (!userModel) {
          throw `[${name}]는 그룹에 존재하지 않는 유저입니다.`;
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
      throw 'invalid params';
    }

    let result = [];
    for (const match of matchingGames) {
      result.push({
        team1: match.team1.map((elem) => summoners[elem.id].name),
        team2: match.team2.map((elem) => summoners[elem.id].name),
        team1WinRate: match.winRate,
      });
    }

    return { result: result, status: 200 };
  } catch (e) {
    return { result: e, status: 501 };
  }
};

module.exports.calculateRating = async (groupName) => {
  if (!groupName) return { result: 'invalid group name' };

  const group = await models.group.findOne({ where: { groupName: groupName } });
  if (!group) return { result: 'group is not exist' };

  // let usableMatchDate = group.usableMatchDate;
  // if (!usableMatchDate)
  //   usableMatchDate = new Date(new Date().getFullYear(), 0);

  const matches = await models.match.findAll({
    where: {
      groupId: {[Op.eq]: group.id},
      winTeam: {[Op.ne]: null},
      // gameCreation: {
      //   [Op.gte]: usableMatchDate
      // }
    },
  });

  matches.sort((a, b) => a.gameCreation > b.gameCreation);

  const groupUsers = await models.user.findAll({
    where: {
      groupId: group.id,
    },
  });

  let users = {};
  for (const user of groupUsers) {
    user.win = 0;
    user.lose = 0;
    user.additionalRating = 0;

    users[String(user.puuid)] = user;
  }

  const getTeam = async (teamData) => {
    let ret = [];
    for (const pair of teamData) {
      let user = users[pair[0]];
      if (user) ret.push(user);
    }
    return ret;
  };

  const apply = (team, isWon, ratingDelta, matchDate) => {
    team.forEach((elem) => {
      if (isWon) elem.win++;
      else elem.lose++;

      elem.additionalRating += ratingDelta;

      if (!elem.latestMatchDate || matchDate > elem.latestMatchDate) {
        elem.latestMatchDate = matchDate;
      }
    });
  };

  const reducer = (total, user) => {
    total += user.defaultRating + user.additionalRating;
    return total;
  };

  let expectationGroup = {};
  for (const match of matches) {
    const team1 = await getTeam(match.team1);
    const team2 = await getTeam(match.team2);

    if (team1.length + team2.length < 7) {
      continue;
    }

    if (team1.length + team2.length < 10) {
      const riotTeamData = match.team1.concat(match.team2);
      riotTeamData.forEach((elem) => {
        if (!users[elem[0]]) {
          expectationGroup[elem[0]] = elem[1];
        }
      });

      continue;
    }

    match.update({ groupId: group.id });

    const team1Rating = team1.reduce(reducer, 0) / 5;
    const team2Rating = team2.reduce(reducer, 0) / 5;

    let team1Delta, team2Delta;
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

    apply(team1, match.winTeam == 1, team1Delta, match.gameCreation);
    apply(team2, match.winTeam == 2, team2Delta, match.gameCreation);
  }

  for (const user of Object.values(users)) {
    await user.update(user.dataValues);
  }

  return {
    result: { expectationGroup: JSON.stringify(expectationGroup) },
    status: 200,
  };
};
