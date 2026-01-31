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

    // 7일 이내이고 데이터가 있으면 캐시 반환
    if (!isExpired(found.positionUpdatedAt) && found.mainPositionRate) {
      result.push([found.mainPosition, found.mainPositionRate]);
      result.push([found.subPosition, found.subPositionRate]);
      return { result, status: 200, skipped: true };
    }

    const SOLO_RANKED_QUEUE = 420;
    const matchIds = await getMatchIdsFromPuuid(found.puuid, 0, 100, SOLO_RANKED_QUEUE);

    // 기존 positionStats 로드 (없으면 초기값)
    const positionStats = found.positionStats || {
      top: 0,
      jungle: 0,
      middle: 0,
      bottom: 0,
      utility: 0,
      lastMatchId: null,
    };

    // lastMatchId 이후의 새 매치만 필터링
    let newMatchIds = matchIds;
    if (positionStats.lastMatchId) {
      const lastMatchIndex = matchIds.indexOf(positionStats.lastMatchId);
      if (lastMatchIndex > 0) {
        // lastMatchId 이전(최신)의 매치들만 처리
        newMatchIds = matchIds.slice(0, lastMatchIndex);
      } else if (lastMatchIndex === 0) {
        // 새 매치 없음
        newMatchIds = [];
      }
      // lastMatchIndex === -1 이면 lastMatchId를 못 찾음 (오래됨) -> 전체 처리
    }

    // 새 매치들의 포지션 카운트
    let processedCount = 0;
    for (let i = 0; i < newMatchIds.length; ++i) {
      const matchData = await getMatchData(newMatchIds[i]);
      const summonerData = matchData.info.participants.find((elem) => elem.puuid == found.puuid);
      if (!summonerData || !summonerData.teamPosition)
        continue;

      const position = summonerData.teamPosition.toLowerCase();
      if (positionStats[position] !== undefined) {
        positionStats[position]++;
        processedCount++;
      }

      // API rate limit 방지 - 1500ms 대기
      if (i < newMatchIds.length - 1) {
        await sleep(1500);
      }
    }

    // lastMatchId 업데이트 (가장 최신 매치)
    if (matchIds.length > 0) {
      positionStats.lastMatchId = matchIds[0];
    }

    // 비율 계산
    const totalMatchCount = positionStats.top + positionStats.jungle + positionStats.middle + positionStats.bottom + positionStats.utility;

    const sorted = [
      ['TOP', positionStats.top],
      ['JUNGLE', positionStats.jungle],
      ['MIDDLE', positionStats.middle],
      ['BOTTOM', positionStats.bottom],
      ['UTILITY', positionStats.utility],
    ].sort((a, b) => b[1] - a[1]);

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
      positionStats: positionStats,
      positionUpdatedAt: moment(),
    });
    await found.save();

    logger.info(`[${name}] 포지션 업데이트: 새 매치 ${processedCount}개 처리, 총 ${totalMatchCount}판`);

    result.push([sorted[0][0], mainPositionRate]);
    result.push([sorted[1][0], subPositionRate]);
  } catch (e) {
    logger.error(e.stack);
    if (e.response && e.response.status === 404)
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
