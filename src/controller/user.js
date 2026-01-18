const models = require('../db/models');
const { logger } = require('../loaders/logger');
const { getCustomGames } = require('../services/riot-api');
const { getRatingTier } = require('../services/user');

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

module.exports.getGroupList = async (puuid) => {
  let result = [];
  try {
    const userInfos = await models.user.findAll({
      where: { puuid },
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

module.exports.getRating = async (groupId, puuid) => {
  if (!groupId) return { result: 'invalid groupId', status: 501 };
  if (!puuid) return { result: 'invalid puuid', status: 501 };

  try {
    const userInfo = await models.user.findOne({
      where: {
        groupId,
        puuid,
      },
      raw: true,
    });

    if (!userInfo) {
      return { result: 'user is not exist', status: 501 };
    }

    const totalRating = userInfo.defaultRating + userInfo.additionalRating;
    const ratingTier = getRatingTier(totalRating);

    return {
      result: {
        defaultRating: userInfo.defaultRating,
        additionalRating: userInfo.additionalRating,
        totalRating: totalRating,
        ratingTier: ratingTier,
      },
      status: 200,
    };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

module.exports.getInfo = async (groupId, puuid) => {
  if (!groupId) return { result: 'invalid groupId', status: 501 };
  if (!puuid) return { result: 'invalid puuid', status: 501 };

  try {
    const userInfo = await models.user.findOne({
      where: {
        groupId,
        puuid,
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
      where: { puuid },
      raw: true,
    });

    if (!summonerInfo) {
      return { result: 'summoner is not exist', status: 501 };
    }

    // const championScore = await models.userChampionScore.findAll({
    //   where: {
    //     groupId,
    //     puuid,
    //   },
    //   raw: true,
    // });

    return { result: { userInfo, summonerInfo }, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};
