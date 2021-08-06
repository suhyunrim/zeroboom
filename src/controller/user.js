const models = require('../db/models');
const { logger } = require('../loaders/logger');
const { getCustomGames } = require('../services/riot-api');
const { getRatingTier } = require('../services/user');

module.exports.login = async (name, accountId, token) => {
  let found = await models.token.findOne({
    where: {
      accountId: accountId,
    },
  });

  const tokenData = {
    name: name,
    accountId: accountId,
    token: token,
  };

  try {
    if (!found) {
      const created = await models.token.create(tokenData);
      return { result: created, status: 200 };
    } else if (found.token !== token || found.name !== name) {
      await found.update(tokenData);
    }
  } catch (e) {
    logger.error(e.stack);
    return { result: found || e.message, status: 501 };
  }

  return { result: found, status: 200 };
};

module.exports.calculateChampionScore = async (groupId, accountId, tokenId) => {
  try {
    const until = new Date(new Date().getFullYear(), 0);
    const riotMatches = await getCustomGames(tokenId, accountId, until);

    const riotMatchIds = riotMatches.map((elem) => elem.gameId);
    const availableMatchIds = await models.match
      .findAll({
        where: { groupId: groupId, gameId: riotMatchIds },
        raw: true,
      })
      .map((elem) => parseInt(elem.gameId));

    const filteredMatches = riotMatches.filter(
      (riotMatch) =>
        availableMatchIds.findIndex((gameId) => gameId === riotMatch.gameId) !==
        -1,
    );

    let userChampionScores = {};
    for (const matchRiotData of filteredMatches) {
      const userData = matchRiotData.participants[0];
      const championId = userData.championId;

      let result = userChampionScores[championId];
      if (!result) {
        result = models.userChampionScore.build().get();
      }

      for (const key in userData.stats) {
        if (!result.hasOwnProperty(key)) continue;

        if (key == 'win') {
          result[userData.stats.win ? 'win' : 'lose']++;
          continue;
        }

        result[key] += userData.stats[key];
      }
      result.gameDuration += matchRiotData.gameDuration;

      result.groupId = groupId;
      result.accountId = accountId;
      result.championId = championId;

      userChampionScores[championId] = result;
    }

    for (const [_, championScore] of Object.entries(userChampionScores)) {
      await models.userChampionScore.upsert(championScore);
    }

    return { result: userChampionScores, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

module.exports.getGroupList = async (accountId) => {
  let result = [];
  try {
    const userInfos = await models.user.findAll({
      where: { accountId: accountId },
    });

    const groupIds = userInfos.map((elem) => elem.groupId);
    const groups = await models.group.findAll({ where: { id: groupIds } });

    for (const group of groups) {
      const userInfo = userInfos.find((elem) => elem.groupId == group.id);
      result.push({
        groupId: group.id,
        groupName: group.groupName,
        defaultRating: userInfo.defaultRating,
        additionalRating: userInfo.additionalRating,
        win: userInfo.win,
        lose: userInfo.lose,
      });
    }
  } catch (e) {
    logger.error(e.stack);
    return { result: result || e.message, status: 501 };
  }

  return { result, status: 200 };
};

module.exports.getRating = async (groupId, riotId) => {
  if (!groupId) return { result: 'invalid groupId', status: 501 };
  if (!riotId) return { result: 'invalid riotId', status: 501 };

  try {
    const userInfo = await models.user.findOne({
      where: {
        groupId,
        riotId,
      },
      raw: true,
    });

    if (!userInfo) {
      return { result: 'user is not exist', status: 501 };
    }

    const totalRating = userInfo.defaultRating + userInfo.additionalRating;
    const ratingTier = getRatingTier(totalRating);

    return { result: {
      defaultRating: userInfo.defaultRating,
      additionalRating: userInfo.additionalRating,
      totalRating: totalRating,
      ratingTier: ratingTier
    }, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

module.exports.getInfo = async (groupId, accountId) => {
  if (!groupId) return { result: 'invalid groupId', status: 501 };
  if (!accountId) return { result: 'invalid accountId', status: 501 };

  try {
    const userInfo = await models.user.findOne({
      where: {
        groupId,
        accountId,
      },
      raw: true,
    });

    if (!userInfo) {
      return { result: 'user is not exist', status: 501 };
    }

    userInfo.ratingTier = getRatingTier(
      userInfo.defaultRating + userInfo.additionalRating,
    );

    const summonerInfo = await models.summoner.findOne({
      where: { accountId },
      raw: true,
    });

    if (!summonerInfo) {
      return { result: 'summoner is not exist', status: 501 };
    }

    const championScore = await models.userChampionScore.findAll({
      where: {
        groupId,
        accountId,
      },
      raw: true,
    });

    return { result: { userInfo, summonerInfo, championScore }, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};
