const moment = require('moment');
const models = require('../db/models');
const { getSummonerByName, getRankDataByPuuid, getMatchIdsFromPuuid, getMatchData, getAccountByPuuid } = require('../services/riot-api');
const { logger } = require('../loaders/logger');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 429 에러 시 재시도하는 래퍼 함수
 * @param {Function} fn - 실행할 함수
 * @param {number} maxRetries - 최대 재시도 횟수
 * @param {number} baseDelay - 기본 대기 시간 (ms)
 * @returns {Promise<any>}
 */
const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 2000) => {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const status = e.response?.status || e.status;

      if (status === 429) {
        // Retry-After 헤더가 있으면 사용, 없으면 지수 백오프
        const retryAfter = e.response?.headers?.['retry-after'];
        const waitTime = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : baseDelay * Math.pow(2, attempt);

        logger.warn(`429 Rate Limited. ${attempt + 1}/${maxRetries + 1} 재시도, ${waitTime}ms 대기`);

        if (attempt < maxRetries) {
          await sleep(waitTime);
          continue;
        }
      }

      // 429가 아니거나 재시도 횟수 초과 시 에러 throw
      throw e;
    }
  }
  throw lastError;
};

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

  // Riot API에서 가져온 실제 닉네임 사용
  const actualName = summonerResult.riotId || name;

  return {
    encryptedAccountId: summonerResult.accountId,
    puuid: summonerResult.puuid,
    name: actualName,
    rankTier: soloRankData ? `${soloRankData.tier} ${soloRankData.rank}` : 'UNRANKED',
    rankWin: soloRankData ? soloRankData.wins : 0,
    rankLose: soloRankData ? soloRankData.losses : 0,
    profileIconId: summonerResult.profileIconId,
    revisionDate: summonerResult.revisionDate,
    summonerLevel: summonerResult.summonerLevel,
    simplifiedName: actualName.toLowerCase().replace(/ /g, ''),
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

/**
 * 소환사 포지션 조회/업데이트
 * @param {string} name - 소환사명
 * @param {Object} options - { force: false }
 * @param {boolean} options.force - true면 캐시 무시하고 강제 업데이트
 * @returns {Promise<Object>}
 */
module.exports.getPositions = async (name, options = {}) => {
  const { force = false } = options;
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

    // 7일 이내이고 데이터가 있으면 캐시 반환 (force가 아닐 때만)
    if (!force && !isExpired(found.positionUpdatedAt) && found.mainPositionRate) {
      result.push([found.mainPosition, found.mainPositionRate]);
      result.push([found.subPosition, found.subPositionRate]);
      return { result, status: 200, skipped: true };
    }

    // 포지션 업데이트 시 닉네임 및 rankTier 갱신 (puuid로 Riot API 조회)
    let updatedName = null;
    let updatedRankTier = null;
    try {
      const accountData = await getAccountByPuuid(found.puuid);
      if (accountData.riotId && accountData.riotId !== found.name) {
        updatedName = accountData.riotId;
        logger.info(`[${name}] 닉네임 변경 감지: ${found.name} -> ${updatedName}`);
      }
    } catch (e) {
      logger.warn(`[${name}] 닉네임 갱신 실패: ${e.message}`);
    }
    try {
      const leagueData = await getRankDataByPuuid(found.puuid);
      const soloRankData = leagueData.find((elem) => elem.queueType === 'RANKED_SOLO_5x5');
      updatedRankTier = soloRankData ? `${soloRankData.tier} ${soloRankData.rank}` : 'UNRANKED';
    } catch (e) {
      logger.warn(`[${name}] rankTier 갱신 실패: ${e.message}`);
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
    let errorCount = 0;
    for (let i = 0; i < newMatchIds.length; ++i) {
      try {
        const matchData = await retryWithBackoff(() => getMatchData(newMatchIds[i]));
        const summonerData = matchData.info.participants.find((elem) => elem.puuid == found.puuid);
        if (!summonerData || !summonerData.teamPosition)
          continue;

        const position = summonerData.teamPosition.toLowerCase();
        if (positionStats[position] !== undefined) {
          positionStats[position]++;
          processedCount++;
        }
      } catch (e) {
        errorCount++;
        const status = e.response?.status || e.status;
        logger.warn(`[${name}] 매치 ${newMatchIds[i]} 조회 실패 (status: ${status}): ${e.message}`);
        // 개별 매치 실패는 건너뛰고 계속 진행
      }

      // API rate limit 방지 - 1500ms 대기
      if (i < newMatchIds.length - 1) {
        await sleep(1500);
      }
    }

    if (errorCount > 0) {
      logger.warn(`[${name}] ${errorCount}개 매치 조회 실패, ${processedCount}개 성공`);
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

    const updateData = {
      mainPosition: sorted[0][0] || null,
      mainPositionRate: mainPositionRate,
      subPosition: sorted[1][0] || null,
      subPositionRate: subPositionRate,
      positionStats: positionStats,
      positionUpdatedAt: moment(),
    };

    // 닉네임 변경이 있으면 함께 업데이트
    if (updatedName) {
      updateData.name = updatedName;
      updateData.simplifiedName = updatedName.toLowerCase().replace(/ /g, '');
    }
    // rankTier 갱신
    if (updatedRankTier) {
      updateData.rankTier = updatedRankTier;
    }

    found.set(updateData);
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

/**
 * 최근 활동 유저들의 포지션 일괄 업데이트 (배치 처리용)
 * @param {Object} options
 * @param {number} options.withinDays - 최근 N일 이내 활동 유저 (기본: 30)
 * @param {boolean} options.force - 캐시 무시 여부 (기본: false)
 * @param {number} options.delayBetweenSummoners - 소환사 간 대기 시간 ms (기본: 3000)
 * @returns {Promise<Object>} { success: [], failed: [], skipped: [], notFound: [] }
 */
module.exports.updateActiveUsersPositions = async (options = {}) => {
  const { withinDays = 30, force = false, delayBetweenSummoners = 3000 } = options;
  const { Op } = require('sequelize');

  const results = {
    success: [],
    failed: [],
    skipped: [],
    notFound: [],
  };

  // 최근 N일 이내 활동한 유저 조회 (중복 puuid 제거)
  const cutoffDate = moment().subtract(withinDays, 'days').toDate();
  const activeUsers = await models.user.findAll({
    where: {
      updatedAt: { [Op.gte]: cutoffDate },
    },
    attributes: ['puuid'],
    group: ['puuid'],
  });

  const puuids = activeUsers.map(u => u.puuid);
  logger.info(`[배치] 최근 ${withinDays}일 내 활동 유저: ${puuids.length}명`);

  // puuid로 소환사 정보 조회
  const summoners = await models.summoner.findAll({
    where: { puuid: puuids },
  });

  const summonerMap = new Map(summoners.map(s => [s.puuid, s]));

  logger.info(`[배치] 포지션 업데이트 시작: ${summoners.length}명`);

  for (let i = 0; i < puuids.length; i++) {
    const puuid = puuids[i];
    const summoner = summonerMap.get(puuid);
    const progress = `[${i + 1}/${puuids.length}]`;

    if (!summoner) {
      results.notFound.push({ puuid });
      logger.warn(`${progress} [${puuid}] 소환사 정보 없음`);
      continue;
    }

    const name = summoner.name;

    try {
      const result = await module.exports.getPositions(name, { force });

      if (result.skipped) {
        results.skipped.push({ name, reason: '캐시 유효' });
        logger.info(`${progress} [${name}] 스킵 (캐시 유효)`);
      } else if (result.status === 200) {
        results.success.push({ name, result: result.result });
        logger.info(`${progress} [${name}] 성공: ${JSON.stringify(result.result)}`);
      } else {
        results.failed.push({ name, error: result.result });
        logger.warn(`${progress} [${name}] 실패: ${result.result}`);
      }
    } catch (e) {
      results.failed.push({ name, error: e.message });
      logger.error(`${progress} [${name}] 에러: ${e.message}`);
    }

    // 소환사 간 대기 (마지막이 아닐 때만)
    if (i < puuids.length - 1) {
      await sleep(delayBetweenSummoners);
    }
  }

  logger.info(`[배치] 포지션 업데이트 완료: 성공 ${results.success.length}, 실패 ${results.failed.length}, 스킵 ${results.skipped.length}, 미발견 ${results.notFound.length}`);

  return results;
};
