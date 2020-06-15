const moment = require('moment');
const models = require('../db/models');
const {
  getSummonerByName,
  getRankDataBySummonerId,
  getSummonerByName_V1,
} = require('../services/riot-api');
const { logger } = require('../loaders/logger');

const expirationCheck = (time) => {
  const timeMoment = moment.isMoment(time) ? time : moment(time);
  timeMoment.add(7, 'd');
  return timeMoment.diff(moment()) <= 0;
};

const generateSummonerData = async (name) => {
  const summonerResult = await getSummonerByName(name);
  const leagueResult = await getRankDataBySummonerId(summonerResult.id);
  const soloRankData = leagueResult.find(
    (elem) => elem.queueType == 'RANKED_SOLO_5x5',
  );

  return {
    riotId: summonerResult.id,
    encryptedAccountId: summonerResult.accountId,
    puuid: summonerResult.puuid,
    name: summonerResult.name,
    rankTier: soloRankData
      ? `${soloRankData.tier} ${soloRankData.rank}`
      : 'UNRANKED',
    rankWin: soloRankData ? soloRankData.wins : 0,
    rankLose: soloRankData ? soloRankData.losses : 0,
    profileIconId: summonerResult.profileIconId,
    revisionDate: summonerResult.revisionDate,
    summonerLevel: summonerResult.summonerLevel,
    simplifiedName: summonerResult.name.toLowerCase().replace(' ', ''),
  };
};

module.exports.getSummonerByName = async (name) => {
  // TODO: 검색 시 대소문자 및 띄어쓰기를 고려 안하게 해야 함.
  let found = await models.summoner.findOne({
    where: {
      simplifiedName: name.toLowerCase().replace(' ', ''),
    },
  });

  if (!found) {
    // no data
    try {
      const summonerData = await generateSummonerData(name);

      found = await models.summoner.findOne({
        where: { riotId: summonerData.riotId },
      });
      if (!found) {
        const created = await models.summoner.create(summonerData);
        return { result: created, status: 200 };
      }

      await found.update({ name: summonerData.name });
    } catch (e) {
      logger.error(e.stack);
      return { result: found || e.message, status: 501 };
    }
  } else if (expirationCheck(found.updatedAt)) {
    // expired data
    try {
      const summonerData = await generateSummonerData(name);
      found.update(summonerData);
    } catch (e) {
      logger.error(e.stack);
      return { result: found || e.message, status: 501 };
    }
  }

  return { result: found, status: 200 };
};

module.exports.getAccountIdByName = async (tokenId, name) => {
  const found = await models.summoner.findOne({ where: { name } });

  if (found && found.accountId) {
    return found.accountId;
  }

  try {
    const summonerResult = await getSummonerByName_V1(tokenId, name);
    return summonerResult.accountId;
  } catch (e) {
    logger.error(e.stack);
  }

  return;
};
