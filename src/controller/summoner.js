const moment = require('moment');
const models = require('../db/models');
const { getSummonerByName, getRankDataByPuuid, getMatchIdsFromPuuid, getMatchData } = require('../services/riot-api');
const { logger } = require('../loaders/logger');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isExpired = (time) => {
  if (!time) {
    return true;
  }

  const timeMoment = moment.isMoment(time) ? time : moment(time);
  timeMoment.add(7, 'd');
  return timeMoment.diff(moment()) <= 0;
};

const generateSummonerData = async (name) => {
  const summonerResult = await getSummonerByName(name);
  const leagueResult = await getRankDataByPuuid(summonerResult.puuid);
  const soloRankData = leagueResult.find((elem) => elem.queueType == 'RANKED_SOLO_5x5');

  return {
    encryptedAccountId: summonerResult.accountId,
    puuid: summonerResult.puuid,
    name,
    rankTier: soloRankData ? `${soloRankData.tier} ${soloRankData.rank}` : 'UNRANKED',
    rankWin: soloRankData ? soloRankData.wins : 0,
    rankLose: soloRankData ? soloRankData.losses : 0,
    profileIconId: summonerResult.profileIconId,
    revisionDate: summonerResult.revisionDate,
    summonerLevel: summonerResult.summonerLevel,
    simplifiedName: name.toLowerCase().replace(/ /g, ''),
  };
};

module.exports.getSummonerByName = async (name) => {
  let found = await models.summoner.findOne({
    where: {
      simplifiedName: name.toLowerCase().replace(/ /g, ''),
    },
  });

  if (!found) {
    try {
      const summonerData = await generateSummonerData(name);

      found = await models.summoner.findOne({
        where: { puuid: summonerData.puuid },
      });
      if (!found) {
        const created = await models.summoner.create(summonerData);
        return { result: created, status: 200 };
      }

      await found.update(summonerData);

      if (summonerData.accountId) {
        models.token.findOne({ where: { accountId: summonerData.accountId } }).then((row) => row.update({ name }));
      }
    } catch (e) {
      logger.error(e.stack);
      if (e.response.status === 404)
        return { result: `[${name}] 은 존재하지 않는 소환사입니다.`, status: 501 }

      return { result: found || e.message, status: 501 };
    }
  } else if (isExpired(found.updatedAt)) {
    try {
      const summonerData = await generateSummonerData(name);
      await found.update(summonerData);
    } catch (e) {
      logger.error(e.stack);
      if (e.response.status === 404)
        return { result: `[${name}] 은 존재하지 않는 소환사입니다.`, status: 501 }

      return { result: found || e.message, status: 501 };
    }
  }

  return { result: found, status: 200 };
};

module.exports.getPositions = async (name) => {
  const positions = {
    TOP: 0,
    JUNGLE: 0,
    MIDDLE: 0,
    BOTTOM: 0,
    UTILITY: 0,
  };

  const result = [];
  let found = await models.summoner.findOne({
    where: {
      simplifiedName: name.toLowerCase().replace(/ /g, ''),
    },
  });

  try {
    if (!found) {
      const summonerData = await generateSummonerData(name);

      found = await models.summoner.findOne({
        where: { puuid: summonerData.puuid },
      });

      if (!found) {
        found = await models.summoner.create(summonerData);
      }

      await found.update(summonerData);
    }

    if (!isExpired(found.positionUpdatedAt) && found.mainPositionRate) {
      result.push([found.mainPosition, found.mainPositionRate]);
      result.push([found.subPosition, found.subPositionRate]);
      return { result, status: 200, skipped: true };
    } else {
      const SOLO_RANKED_QUEUE = 420;
      const matchids = await getMatchIdsFromPuuid(found.puuid, 0, 100, SOLO_RANKED_QUEUE);
      for (let i = 0; i < matchids.length; ++i) {
        const matchData = await getMatchData(matchids[i]);
        const summonerData = matchData.info.participants.find((elem) => elem.puuid == found.puuid);
        if (!summonerData || !summonerData.teamPosition)
          continue;

        positions[summonerData.teamPosition]++;

        // API rate limit 방지 - 1500ms 대기
        if (i < matchids.length - 1) {
          await sleep(1500);
        }
      }

      let totalMatchCount = 0;
      const sorted = Object.keys(positions).map((key) => {
        const count = positions[key];
        totalMatchCount += count;
        return [key, count];
      });

      sorted.sort((first, second) => {
        return second[1] - first[1];
      });

      const mainPositionRate = totalMatchCount > 0
        ? parseFloat(((sorted[0][1] / totalMatchCount) * 100).toFixed(2))
        : 0;
      const subPositionRate = totalMatchCount > 0
        ? parseFloat(((sorted[1][1] / totalMatchCount) * 100).toFixed(2))
        : 0;

      found.set({
        mainPosition: sorted[0][0] || null,
        mainPositionRate: mainPositionRate,
        subPosition: sorted[1][0] || null,
        subPositionRate: subPositionRate,
        positionUpdatedAt: moment(),
      });
      await found.save();

      result.push([sorted[0][0], mainPositionRate]);
      result.push([sorted[1][0], subPositionRate]);
    }
  } catch (e) {
    logger.error(e.stack);
    if (e.response.status === 404)
        return { result: `[${name}] 은 존재하지 않는 소환사입니다.`, status: 501 }
    
    return { result: found || e.message, status: 501 };
  }

  return { result, status: 200 };
};

module.exports.getAccountIdByName = async (name) => {
  const found = await models.summoner.findOne({ where: { name } });

  if (found && found.accountId) {
    return found.accountId;
  }

  try {
    const summonerResult = await getSummonerByName(name);
    return String(summonerResult.accountId);
  } catch (e) {
    logger.error(e.stack);
  }

  return;
};
