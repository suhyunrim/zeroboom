const moment = require('moment');
const models = require('../db/models');
const { getSummonerByName, getRankDataBySummonerId, getSummonerByName_V1 } = require('../services/riot-api');
const { logger } = require('../loaders/logger');

const expirationCheck = (time, duration = { unit: 'days', number: 1 }) => {
    const timeMoment = moment.isMoment(time) ? time : moment(time);
    const durationMoment = moment.isDuration(duration)
      ? duration
      : moment.duration(duration);
    const expiredAt = timeMoment.add(durationMoment);
  
    return expiredAt.diff(moment()) <= 0;
  };

const generateSummonerData = async (name) => {
  const summonerResult = await getSummonerByName(name);
  const leagueResult = await getRankDataBySummonerId(summonerResult.id);
  const soloRankData = leagueResult.find(elem => elem.queueType == 'RANKED_SOLO_5x5');

  return {
    riotId: summonerResult.id,
    encryptedAccountId: summonerResult.accountId,
    puuid: summonerResult.puuid,
    name: summonerResult.name,
    rankTier: soloRankData ? `${soloRankData.tier} ${soloRankData.rank}` : 'UNRANKED',
    rankWin: soloRankData ? soloRankData.wins : 0,
    rankLose: soloRankData ? soloRankData.losses : 0,
    profileIconId: summonerResult.profileIconId,
    revisionDate: summonerResult.revisionDate,
    summonerLevel: summonerResult.summonerLevel,
  };
};

module.exports.getSummonerByName = async (name) => {
  // TODO: 검색 시 대소문자 및 띄어쓰기를 고려 안하게 해야 함.
  const found = await models.summoner.findOne({ where: { name } });

  // no data
  if (!found) {
    try {
      const summonerData = await generateSummonerData(name);
      
      // TODO: 닉변한 케이스에서 riotId 가 겹치는 경우 update로 처리해야 함
      const created = await models.summoner.create(summonerData);

      return { result: created, status: 200 };
    } catch (e) {
      logger.error(e.stack);
      return { result: found || e.message, status: 501 };
    }
  }

  // expired data
  if (expirationCheck(found.updatedAt)) {
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
}
