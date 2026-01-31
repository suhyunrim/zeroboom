const models = require('../db/models');
const { Op } = require('sequelize');
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

    // 최근 매치가 있는 그룹을 첫 번째로 정렬
    if (result.length > 1) {
      const latestMatch = await models.match.findOne({
        where: {
          groupId: groupIds,
          [Op.or]: [
            { team1: { [Op.like]: `%${puuid}%` } },
            { team2: { [Op.like]: `%${puuid}%` } },
          ],
        },
        order: [['createdAt', 'DESC']],
        raw: true,
      });

      if (latestMatch) {
        result.sort((a, b) => {
          if (a.groupId === latestMatch.groupId) return -1;
          if (b.groupId === latestMatch.groupId) return 1;
          return 0;
        });
      }
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

// 상세 통계 계산 상수
const MIN_GAMES_FOR_BEST_TEAMMATE = 3; // 베스트 팀원 최소 판수
const MIN_GAMES_FOR_BEST_OPPONENT = 2; // 상대 전적 최소 판수
const RECENT_GAMES_COUNT = 10; // 최근 N판 승률 계산용

/**
 * 사용자별 상세 통계 계산
 * @param {number} groupId - 그룹 ID
 * @param {string} myPuuid - 조회 대상 유저 puuid
 * @returns {Promise<Object|null>} 상세 통계
 */
const calculateDetailedStats = async (groupId, myPuuid) => {
  // 완료된 매치 전체 조회
  const matches = await models.match.findAll({
    where: {
      groupId,
      winTeam: { [Op.ne]: null },
    },
    order: [['createdAt', 'ASC']],
    raw: true,
  });

  if (matches.length === 0) {
    return null;
  }

  // puuid -> name 매핑을 위한 캐시
  const nameCache = {};
  const getName = async (puuid) => {
    if (!nameCache[puuid]) {
      const summoner = await models.summoner.findOne({
        where: { puuid },
        attributes: ['name'],
        raw: true,
      });
      nameCache[puuid] = summoner?.name || 'Unknown';
    }
    return nameCache[puuid];
  };

  // 팀원 통계 (같은 팀)
  const teammateStats = {}; // { puuid: { games, wins, losses } }
  // 상대 통계
  const opponentStats = {}; // { puuid: { games, myWins, myLosses } }
  // 매치 히스토리 (연승/연패 및 최근 N판 용)
  const matchHistory = []; // [{ won: bool, createdAt }]

  for (const match of matches) {
    const team1 = JSON.parse(match.team1);
    const team2 = JSON.parse(match.team2);
    const winTeam = match.winTeam;
    const createdAt = match.createdAt;

    const team1Puuids = team1.map(([puuid]) => puuid);
    const team2Puuids = team2.map(([puuid]) => puuid);

    const myTeam = team1Puuids.includes(myPuuid)
      ? 1
      : team2Puuids.includes(myPuuid)
        ? 2
        : null;

    if (myTeam === null) continue; // 내가 참여 안한 매치

    const myWon = winTeam === myTeam;
    matchHistory.push({ won: myWon, createdAt });

    // 같은 팀 멤버 통계
    const myTeamPuuids = myTeam === 1 ? team1Puuids : team2Puuids;
    for (const puuid of myTeamPuuids) {
      if (puuid === myPuuid) continue;
      if (!teammateStats[puuid]) {
        teammateStats[puuid] = { games: 0, wins: 0, losses: 0 };
      }
      teammateStats[puuid].games++;
      if (myWon) {
        teammateStats[puuid].wins++;
      } else {
        teammateStats[puuid].losses++;
      }
    }

    // 상대 팀 멤버 통계
    const enemyTeamPuuids = myTeam === 1 ? team2Puuids : team1Puuids;
    for (const puuid of enemyTeamPuuids) {
      if (!opponentStats[puuid]) {
        opponentStats[puuid] = { games: 0, myWins: 0, myLosses: 0 };
      }
      opponentStats[puuid].games++;
      if (myWon) {
        opponentStats[puuid].myWins++;
      } else {
        opponentStats[puuid].myLosses++;
      }
    }
  }

  // 시간순 정렬
  matchHistory.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  // 1. 같은 팀 많이 된 사람 Top 5
  const topTeammates = await Promise.all(
    Object.entries(teammateStats)
      .sort((a, b) => b[1].games - a[1].games)
      .slice(0, 5)
      .map(async ([puuid, stats]) => ({
        puuid,
        name: await getName(puuid),
        games: stats.games,
        wins: stats.wins,
        losses: stats.losses,
        winRate: Math.round((stats.wins / stats.games) * 100),
      }))
  );

  // 2. 상대 팀 많이 된 사람 Top 5
  const topOpponents = await Promise.all(
    Object.entries(opponentStats)
      .sort((a, b) => b[1].games - a[1].games)
      .slice(0, 5)
      .map(async ([puuid, stats]) => ({
        puuid,
        name: await getName(puuid),
        games: stats.games,
        myWins: stats.myWins,
        myLosses: stats.myLosses,
        winRate: Math.round((stats.myWins / stats.games) * 100),
      }))
  );

  // 3. 같은 팀 N판 이상 중 승률 제일 높은 사람
  const bestTeammate = await (async () => {
    const candidates = Object.entries(teammateStats)
      .filter(([, stats]) => stats.games >= MIN_GAMES_FOR_BEST_TEAMMATE)
      .map(([puuid, stats]) => ({
        puuid,
        ...stats,
        winRate: (stats.wins / stats.games) * 100,
      }))
      .sort((a, b) => b.winRate - a.winRate || b.games - a.games);

    if (candidates.length === 0) return null;
    const best = candidates[0];
    return {
      puuid: best.puuid,
      name: await getName(best.puuid),
      games: best.games,
      wins: best.wins,
      losses: best.losses,
      winRate: Math.round(best.winRate),
    };
  })();

  // 4. 최근 N판 승률
  const recentMatches = matchHistory.slice(-RECENT_GAMES_COUNT);
  const recentWins = recentMatches.filter((m) => m.won).length;
  const recentGames = recentMatches.length;
  const recentWinRate = recentGames > 0 ? Math.round((recentWins / recentGames) * 100) : 0;

  // 5. 최다 연승 / 최다 연패
  let maxWinStreak = 0;
  let maxLoseStreak = 0;
  let currentWinStreak = 0;
  let currentLoseStreak = 0;

  for (const { won } of matchHistory) {
    if (won) {
      currentWinStreak++;
      currentLoseStreak = 0;
      maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
    } else {
      currentLoseStreak++;
      currentWinStreak = 0;
      maxLoseStreak = Math.max(maxLoseStreak, currentLoseStreak);
    }
  }

  // 6. 상대 전적 제일 좋은 사람 (내 승률 기준 최고, 최소 2판 이상)
  const bestOpponent = await (async () => {
    const candidates = Object.entries(opponentStats)
      .filter(([, stats]) => stats.games >= MIN_GAMES_FOR_BEST_OPPONENT)
      .map(([puuid, stats]) => ({
        puuid,
        ...stats,
        winRate: (stats.myWins / stats.games) * 100,
      }))
      .sort((a, b) => b.winRate - a.winRate || b.games - a.games);

    if (candidates.length === 0) return null;
    const best = candidates[0];
    return {
      puuid: best.puuid,
      name: await getName(best.puuid),
      games: best.games,
      myWins: best.myWins,
      myLosses: best.myLosses,
      winRate: Math.round(best.winRate),
    };
  })();

  // 7. 상대 전적 제일 안 좋은 사람 (내 승률 기준 최저, 최소 2판 이상)
  const worstOpponent = await (async () => {
    const candidates = Object.entries(opponentStats)
      .filter(([, stats]) => stats.games >= MIN_GAMES_FOR_BEST_OPPONENT)
      .map(([puuid, stats]) => ({
        puuid,
        ...stats,
        winRate: (stats.myWins / stats.games) * 100,
      }))
      .sort((a, b) => a.winRate - b.winRate || b.games - a.games);

    if (candidates.length === 0) return null;
    const worst = candidates[0];
    return {
      puuid: worst.puuid,
      name: await getName(worst.puuid),
      games: worst.games,
      myWins: worst.myWins,
      myLosses: worst.myLosses,
      winRate: Math.round(worst.winRate),
    };
  })();

  return {
    topTeammates,
    topOpponents,
    bestTeammate,
    recentGames,
    recentWins,
    recentWinRate,
    maxWinStreak,
    maxLoseStreak,
    bestOpponent,
    worstOpponent,
  };
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

    // externalRecord 승패 합산 (만료 여부 상관없이 전체)
    const externalRecords = await models.externalRecord.findAll({
      where: {
        groupId,
        puuid,
      },
      raw: true,
    });

    // 기본 승패 + 외부 기록 승패 합산
    for (const record of externalRecords) {
      userInfo.win = (userInfo.win || 0) + (record.win || 0);
      userInfo.lose = (userInfo.lose || 0) + (record.lose || 0);
    }

    const summonerInfo = await models.summoner.findOne({
      where: { puuid },
      raw: true,
    });

    if (!summonerInfo) {
      return { result: 'summoner is not exist', status: 501 };
    }

    // 상세 통계 계산
    const detailedStats = await calculateDetailedStats(groupId, puuid);

    return { result: { userInfo, summonerInfo, detailedStats }, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};
