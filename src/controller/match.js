const models = require('../db/models');
const moment = require('moment');
const { Op } = require('sequelize');
const table = require('table');

const summonerController = require('../controller/summoner');
const honorController = require('../controller/honor');

const elo = require('arpad');
const { getSummonerByName_V1, getCustomGames, getMatchData } = require('../services/riot-api');
const { logger } = require('../loaders/logger');

const ratingCalculator = new elo(16);
const matchMaker = require('../match-maker/match-maker');
const User = require('../entity/user').User;
const { formatTier } = require('../utils/tierUtils');
const {
  getKSTYearStart, getKSTIsoWeekday, getKSTHours, daysAgo,
  isWeekendTime, isWeekdayTime, getKSTDateKey, kstDayKeyDiff,
} = require('../utils/timeUtils');
const { STAT_TYPES } = require('../services/achievement/definitions');
const statsRepo = require('../services/achievement/stats');

/**
 * 매치 생성 + 레이팅 스냅샷 + seasonId 자동 처리
 * @param {object} params
 * @param {number} params.groupId
 * @param {Array<[string, string]>} params.team1 - [[puuid, name], ...]
 * @param {Array<[string, string]>} params.team2
 * @param {object} [params.extra] - winTeam, gameCreation, createdAt 등 추가 필드
 * @returns {Promise<object>} 생성된 match 레코드
 */
module.exports.createMatchWithSnapshot = async ({ groupId, team1, team2, extra = {} }) => {
  const allPuuids = [...team1, ...team2].map(([puuid]) => puuid);
  const users = await models.user.findAll({
    where: { puuid: allPuuids, groupId },
    attributes: ['puuid', 'defaultRating', 'additionalRating'],
  });
  const ratingMap = new Map(
    users.map((u) => [u.puuid, Math.round(u.defaultRating + u.additionalRating)]),
  );
  const withRating = (arr) => arr.map(([puuid, name]) => [puuid, name, ratingMap.get(puuid) ?? 500]);

  const group = await models.group.findByPk(groupId, { attributes: ['settings'] });
  const currentSeason = (group?.settings && group.settings.currentSeason) || 1;

  return models.match.create({
    groupId,
    team1: withRating(team1),
    team2: withRating(team2),
    seasonId: currentSeason,
    ...extra,
  });
};

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
    const until = latestGameCreation ? latestGameCreation.gameCreation : getKSTYearStart();
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
        simpleMatchData.gameCreation >= newLatestGameCreation ? simpleMatchData.gameCreation : newLatestGameCreation;

      const gameId = simpleMatchData.gameId;
      if (matchIdsInDB.find((elem) => elem === gameId)) continue;

      const matchData = await getMatchData(tokenId, gameId);
      if (!matchData || matchData.team1.length + matchData.team2.length !== 10) continue;

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

  const allNames = [...team1, ...team2];
  const summoners = await models.summoner.findAll({
    where: { name: allNames },
    attributes: ['puuid', 'name'],
    raw: true,
  });
  const puuidByName = {};
  for (const s of summoners) {
    puuidByName[s.name] = s.puuid;
  }

  const users = await models.user.findAll({
    where: {
      groupId: group.id,
      puuid: summoners.map((s) => s.puuid),
    },
    attributes: ['puuid', 'defaultRating', 'additionalRating'],
    raw: true,
  });
  const ratingByPuuid = {};
  for (const u of users) {
    ratingByPuuid[u.puuid] = u.defaultRating + u.additionalRating;
  }

  let team1RatingMap = {};
  for (const name of team1) team1RatingMap[name] = ratingByPuuid[puuidByName[name]];

  let team2RatingMap = {};
  for (const name of team2) team2RatingMap[name] = ratingByPuuid[puuidByName[name]];

  const team1Rating = Object.values(team1RatingMap).reduce((total, current) => total + current) / 5;
  const team2Rating = Object.values(team2RatingMap).reduce((total, current) => total + current) / 5;
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

module.exports.generateMatch = async (groupName, team1Names, team2Names, userPool, matchCount, discordIdMap = {}) => {
  try {
    const { pickCount } = require('../config');
    if (team1Names.length + team2Names.length + userPool.length !== pickCount) {
      throw `자동매칭에 필요한 유저 수는 ${pickCount}명입니다.`;
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
      // discordId가 있으면 먼저 그걸로 조회 시도
      const discordId = discordIdMap[summonerName];
      if (discordId) {
        const userByDiscord = await models.user.findOne({
          where: { groupId: group.id, discordId },
        });
        if (userByDiscord) {
          const summonerByPuuid = await models.summoner.findOne({
            where: { puuid: userByDiscord.puuid },
          });
          if (summonerByPuuid) {
            if (!summoners[summonerByPuuid.puuid]) {
              summoners[summonerByPuuid.puuid] = summonerByPuuid;
            }
            return userByDiscord;
          }
        }
      }

      // discordId로 못 찾으면 기존 방식으로 조회
      const result = await summonerController.getSummonerByName(summonerName);

      if (result.status !== 200) {
        throw `[${summonerName}]는 존재하지 않는 소환사입니다.`;
      }

      const summoner = result.result;
      if (!summoners[summoner.puuid]) {
        summoners[summoner.puuid] = summoner;
      }

      return await models.user.findOne({
        where: {
          groupId: group.id,
          puuid: summoner.puuid,
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

    const matchingGames = matchMaker.matchMake(preOrganizationTeam1, preOrganizationTeam2, makerUserPool, matchCount);
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
      groupId: { [Op.eq]: group.id },
      winTeam: { [Op.ne]: null },
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

    const team1Rating = team1.reduce(reducer, 0) / 5;
    const team2Rating = team2.reduce(reducer, 0) / 5;

    let team1Delta, team2Delta;
    if (match.winTeam == 1) {
      team1Delta = ratingCalculator.newRatingIfWon(team1Rating, team2Rating) - team1Rating;
      team2Delta = ratingCalculator.newRatingIfLost(team2Rating, team1Rating) - team2Rating;
    } else {
      team1Delta = ratingCalculator.newRatingIfLost(team1Rating, team2Rating) - team1Rating;
      team2Delta = ratingCalculator.newRatingIfWon(team2Rating, team1Rating) - team2Rating;
    }

    apply(team1, match.winTeam == 1, team1Delta, match.createdAt);
    apply(team2, match.winTeam == 2, team2Delta, match.createdAt);
  }

  for (const user of Object.values(users)) {
    await user.update(user.dataValues);
  }

  return {
    result: { expectationGroup: JSON.stringify(expectationGroup) },
    status: 200,
  };
};

// 단일 매치 결과 적용 (10명만 업데이트)
// previousWinTeam: 이전에 적용된 승리팀 (null이면 첫 적용)
module.exports.applyMatchResult = async (gameId, previousWinTeam = null) => {
  const matchData = await models.match.findOne({
    where: { gameId },
  });

  if (!matchData) return { result: 'match not found', status: 404 };
  if (!matchData.winTeam && !previousWinTeam) return { result: 'winTeam not set', status: 400 };

  const team1Data = matchData.team1; // [[puuid, name], ...] 또는 [[puuid, name, rating], ...]
  const team2Data = matchData.team2;
  const hasSnapshot = team1Data[0] && team1Data[0].length >= 3;

  // 매치 참가자들의 유저 정보 조회
  const allPuuids = [...team1Data.map((p) => p[0]), ...team2Data.map((p) => p[0])];
  const users = await models.user.findAll({
    where: {
      groupId: matchData.groupId,
      puuid: allPuuids,
    },
  });

  const userMap = {};
  for (const user of users) {
    userMap[user.puuid] = user;
  }

  // 스냅샷 레이팅 기반 팀 평균 계산
  const getSnapshotAvgRating = (teamData) => {
    let total = 0;
    let count = 0;
    for (const [puuid, , rating] of teamData) {
      if (userMap[puuid]) {
        total += rating;
        count++;
      }
    }
    return count > 0 ? total / count : 500;
  };

  // 현재 레이팅 기반 팀 평균 계산
  const getCurrentAvgRating = (teamData) => {
    let total = 0;
    let count = 0;
    for (const [puuid] of teamData) {
      const user = userMap[puuid];
      if (user) {
        total += user.defaultRating + user.additionalRating;
        count++;
      }
    }
    return count > 0 ? total / count : 500;
  };

  // === 이전 결과 되돌리기 ===
  if (previousWinTeam && hasSnapshot) {
    const snapTeam1Avg = getSnapshotAvgRating(team1Data);
    const snapTeam2Avg = getSnapshotAvgRating(team2Data);

    let oldTeam1Delta, oldTeam2Delta;
    if (previousWinTeam === 1) {
      oldTeam1Delta = ratingCalculator.newRatingIfWon(snapTeam1Avg, snapTeam2Avg) - snapTeam1Avg;
      oldTeam2Delta = ratingCalculator.newRatingIfLost(snapTeam2Avg, snapTeam1Avg) - snapTeam2Avg;
    } else {
      oldTeam1Delta = ratingCalculator.newRatingIfLost(snapTeam1Avg, snapTeam2Avg) - snapTeam1Avg;
      oldTeam2Delta = ratingCalculator.newRatingIfWon(snapTeam2Avg, snapTeam1Avg) - snapTeam2Avg;
    }

    for (const [puuid] of team1Data) {
      const user = userMap[puuid];
      if (user) {
        const wasWin = previousWinTeam === 1;
        await user.update({
          win: user.win - (wasWin ? 1 : 0),
          lose: user.lose - (wasWin ? 0 : 1),
          additionalRating: user.additionalRating - oldTeam1Delta,
        });
      }
    }

    for (const [puuid] of team2Data) {
      const user = userMap[puuid];
      if (user) {
        const wasWin = previousWinTeam === 2;
        await user.update({
          win: user.win - (wasWin ? 1 : 0),
          lose: user.lose - (wasWin ? 0 : 1),
          additionalRating: user.additionalRating - oldTeam2Delta,
        });
      }
    }

    // userMap 갱신 (되돌린 값 반영)
    for (const user of Object.values(userMap)) {
      await user.reload();
    }
  }

  // winTeam이 null이면 되돌리기만 수행 (취소)
  if (!matchData.winTeam) {
    return { result: 'success', status: 200 };
  }

  // === 새 결과 적용 ===
  // 스냅샷이 있으면 원래 시점의 레이팅으로 delta 계산, 없으면 현재 레이팅 사용
  const team1AvgRating = hasSnapshot ? getSnapshotAvgRating(team1Data) : getCurrentAvgRating(team1Data);
  const team2AvgRating = hasSnapshot ? getSnapshotAvgRating(team2Data) : getCurrentAvgRating(team2Data);

  let team1Delta, team2Delta;
  if (matchData.winTeam === 1) {
    team1Delta = ratingCalculator.newRatingIfWon(team1AvgRating, team2AvgRating) - team1AvgRating;
    team2Delta = ratingCalculator.newRatingIfLost(team2AvgRating, team1AvgRating) - team2AvgRating;
  } else {
    team1Delta = ratingCalculator.newRatingIfLost(team1AvgRating, team2AvgRating) - team1AvgRating;
    team2Delta = ratingCalculator.newRatingIfWon(team2AvgRating, team1AvgRating) - team2AvgRating;
  }

  // 레이팅 스냅샷 생성 (첫 적용 시에만)
  if (!hasSnapshot) {
    const team1WithRating = team1Data.map(([puuid, name]) => {
      const user = userMap[puuid];
      const rating = user ? Math.round(user.defaultRating + user.additionalRating) : 500;
      return [puuid, name, rating];
    });
    const team2WithRating = team2Data.map(([puuid, name]) => {
      const user = userMap[puuid];
      const rating = user ? Math.round(user.defaultRating + user.additionalRating) : 500;
      return [puuid, name, rating];
    });
    await matchData.update({ team1: team1WithRating, team2: team2WithRating });
  }

  // 언더독/야식 판별
  const team1WinRate = ratingCalculator.expectedScore(team1AvgRating, team2AvgRating);
  const isTeam1Underdog = matchData.winTeam === 1 && team1WinRate <= 0.45;
  const isTeam2Underdog = matchData.winTeam === 2 && 1 - team1WinRate <= 0.45;
  const matchDateForTime = matchData.gameCreation || matchData.createdAt;
  const isLateNight = getKSTHours(matchDateForTime) < 5;
  const isWeekend = isWeekendTime(matchDateForTime);
  const isWeekday = isWeekdayTime(matchDateForTime);
  const matchDayKey = getKSTDateKey(matchDateForTime);

  // 각 유저 업데이트
  const now = new Date();
  const matchDate = matchData.createdAt;
  for (const [puuid] of team1Data) {
    const user = userMap[puuid];
    if (user) {
      const isWin = matchData.winTeam === 1;
      const updateData = {
        win: user.win + (isWin ? 1 : 0),
        lose: user.lose + (isWin ? 0 : 1),
        additionalRating: user.additionalRating + team1Delta,
      };
      if (!user.firstMatchDate) updateData.firstMatchDate = now;
      if (!user.latestMatchDate || matchDate > user.latestMatchDate) updateData.latestMatchDate = matchDate;
      await user.update(updateData);
    }
  }

  for (const [puuid] of team2Data) {
    const user = userMap[puuid];
    if (user) {
      const isWin = matchData.winTeam === 2;
      const updateData = {
        win: user.win + (isWin ? 1 : 0),
        lose: user.lose + (isWin ? 0 : 1),
        additionalRating: user.additionalRating + team2Delta,
      };
      if (!user.firstMatchDate) updateData.firstMatchDate = now;
      if (!user.latestMatchDate || matchDate > user.latestMatchDate) updateData.latestMatchDate = matchDate;
      await user.update(updateData);
    }
  }

  // 업적 통계 업데이트 (언더독/야식/연승연패/시간대/출석/환영/하루 N판)
  {
    const gid = matchData.groupId;
    const incrementStat = (puuid, statType) => statsRepo.incrementStat(puuid, gid, statType);
    const setStat = (puuid, statType, value) => statsRepo.setStat(puuid, gid, statType, value);
    const updateBestStat = (puuid, statType, value) => statsRepo.updateBestStat(puuid, gid, statType, value);

    // 현재 연승/연패 계산 (최근 매치만 조회)
    const recentMatches = await models.match.findAll({
      where: {
        groupId: matchData.groupId,
        winTeam: { [Op.ne]: null },
      },
      order: [['createdAt', 'DESC']],
      limit: 30,
    });

    // 뉴비 기준일: 매치 시각 기준 3주 전 (환영위원회 판정에 사용)
    const NEWBIE_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
    const newbieCutoff = new Date(new Date(matchDateForTime).getTime() - NEWBIE_WINDOW_MS);

    const statsUpdates = [];
    for (const [puuid] of [...team1Data, ...team2Data]) {
      if (!userMap[puuid]) continue;
      const inTeam1 = team1Data.some((p) => p[0] === puuid);

      // 언더독/야식
      const isUnderdog = inTeam1 ? isTeam1Underdog : isTeam2Underdog;
      if (isUnderdog) statsUpdates.push(incrementStat(puuid, STAT_TYPES.UNDERDOG_WINS));
      if (isLateNight) statsUpdates.push(incrementStat(puuid, STAT_TYPES.LATE_NIGHT_GAMES));

      // 솔로신가요? / 평일 근로자
      if (isWeekend) statsUpdates.push(incrementStat(puuid, STAT_TYPES.WEEKEND_GAMES));
      if (isWeekday) statsUpdates.push(incrementStat(puuid, STAT_TYPES.WEEKDAY_GAMES));

      // 환영위원회: 승리 + 같은 팀에 뉴비 있음 (본인 포함이면 불가 → 본인 제외 팀메이트 뉴비 여부)
      const isWin = (inTeam1 && matchData.winTeam === 1) || (!inTeam1 && matchData.winTeam === 2);
      if (isWin) {
        const myTeam = inTeam1 ? team1Data : team2Data;
        const teamHasNewbieExceptMe = myTeam.some(([p]) => {
          if (p === puuid) return false;
          const u = userMap[p];
          return u && u.createdAt && new Date(u.createdAt) >= newbieCutoff;
        });
        if (teamHasNewbieExceptMe) statsUpdates.push(incrementStat(puuid, STAT_TYPES.WELCOMER_WINS));
      }

      // 하루 N판 + 연속 출석: today_key 기반 계산
      statsUpdates.push((async () => {
        const existingDay = await models.user_achievement_stats.findOne({
          where: { puuid, groupId: matchData.groupId, statType: STAT_TYPES.TODAY_KEY },
          raw: true,
        });
        const prevKey = existingDay ? Number(existingDay.value) : null;
        const isSameDay = prevKey === matchDayKey;

        // 하루 N판: games_in_today
        let gamesToday;
        if (isSameDay) {
          await incrementStat(puuid, STAT_TYPES.GAMES_IN_TODAY);
          const row = await models.user_achievement_stats.findOne({
            where: { puuid, groupId: matchData.groupId, statType: STAT_TYPES.GAMES_IN_TODAY },
            raw: true,
          });
          gamesToday = row ? Number(row.value) : 1;
        } else {
          await setStat(puuid, STAT_TYPES.GAMES_IN_TODAY, 1);
          gamesToday = 1;
        }

        // 연속 출석: 전날이면 +1, 더 떨어지면 리셋, 같은 날이면 유지(0이면 1로)
        const currentRow = await models.user_achievement_stats.findOne({
          where: { puuid, groupId: matchData.groupId, statType: STAT_TYPES.CURRENT_CONSECUTIVE_DAYS },
          raw: true,
        });
        let current = currentRow ? Number(currentRow.value) : 0;
        if (prevKey === null) {
          current = 1;
        } else if (isSameDay) {
          if (current === 0) current = 1;
        } else {
          const diff = kstDayKeyDiff(matchDayKey, prevKey);
          current = diff === 1 ? current + 1 : 1;
        }
        await setStat(puuid, STAT_TYPES.CURRENT_CONSECUTIVE_DAYS, current);
        await updateBestStat(puuid, STAT_TYPES.BEST_CONSECUTIVE_DAYS, current);

        // today_key 갱신 + 하루 최다 판수 max 갱신
        await setStat(puuid, STAT_TYPES.TODAY_KEY, matchDayKey);
        await updateBestStat(puuid, STAT_TYPES.MAX_GAMES_PER_DAY, gamesToday);
      })());

      // 현재 연승/연패 계산
      let winStreak = 0;
      let loseStreak = 0;
      for (const m of recentMatches) {
        const inT1 = m.team1.some((p) => p[0] === puuid);
        const inT2 = m.team2.some((p) => p[0] === puuid);
        if (!inT1 && !inT2) continue;
        const won = (inT1 && m.winTeam === 1) || (inT2 && m.winTeam === 2);
        if (winStreak === 0 && loseStreak === 0) {
          if (won) winStreak = 1;
          else loseStreak = 1;
        } else if (winStreak > 0 && won) {
          winStreak += 1;
        } else if (loseStreak > 0 && !won) {
          loseStreak += 1;
        } else {
          break;
        }
      }
      if (winStreak > 0) statsUpdates.push(updateBestStat(puuid, STAT_TYPES.BEST_WIN_STREAK, winStreak));
      if (loseStreak > 0) statsUpdates.push(updateBestStat(puuid, STAT_TYPES.BEST_LOSE_STREAK, loseStreak));

      // 역대 최고 레이팅
      const user = userMap[puuid];
      if (user) {
        const currentRating = Math.round(user.defaultRating + user.additionalRating);
        statsUpdates.push(updateBestStat(puuid, STAT_TYPES.BEST_RATING, currentRating));
      }
    }
    await Promise.all(statsUpdates);

    // 3판2선 세트 판별 (역전승/역전패/스윕 승/패)
    await processSetAchievements(matchData, userMap, team1Data, team2Data);
  }

  // 업적 체크 (새 결과 적용 시에만)
  let newAchievements = [];
  if (matchData.winTeam) {
    const { processAchievements } = require('../services/achievement/engine');
    newAchievements = await processAchievements('match_result', {
      groupId: matchData.groupId,
      matchData,
      userMap,
    });
  }

  return { result: 'success', status: 200, newAchievements };
};

module.exports.cancelMatch = async (groupId, matchId) => {
  if (!matchId) {
    return { status: 400, result: { error: 'matchId는 필수입니다.' } };
  }

  const matchData = await models.match.findOne({
    where: { gameId: matchId, groupId },
  });

  if (!matchData) {
    return { status: 404, result: { error: '해당 매치를 찾을 수 없습니다.' } };
  }

  const previousWinTeam = matchData.winTeam;
  if (!previousWinTeam) {
    return { status: 400, result: { error: '이미 취소된 매치입니다.' } };
  }

  await Promise.all([honorController.deleteVotesByGameId(matchId), matchData.update({ winTeam: null })]);
  await module.exports.applyMatchResult(matchId, previousWinTeam);

  return { status: 200, result: { gameId: matchId } };
};

module.exports.duplicateMatch = async (groupId, matchId, date, winTeam) => {
  if (!matchId || !date || ![1, 2].includes(winTeam)) {
    return { status: 400, result: { error: 'matchId, date, winTeam(1 또는 2)은 필수입니다.' } };
  }

  const originalMatch = await models.match.findOne({
    where: { gameId: matchId, groupId },
  });

  if (!originalMatch) {
    return { status: 404, result: { error: '해당 매치를 찾을 수 없습니다.' } };
  }

  const team1 = originalMatch.team1.map(([puuid, name]) => [puuid, name]);
  const team2 = originalMatch.team2.map(([puuid, name]) => [puuid, name]);
  const matchDate = new Date(date);

  const newMatch = await module.exports.createMatchWithSnapshot({
    groupId,
    team1,
    team2,
    extra: {
      winTeam,
      gameCreation: matchDate,
      createdAt: matchDate,
    },
  });

  await module.exports.applyMatchResult(newMatch.gameId);

  return { status: 200, result: { gameId: newMatch.gameId } };
};

module.exports.getMatchHistory = async (groupName, from, to) => {
  if (!groupName) return { status: 900, result: 'invalid group name' };

  const group = await models.group.findOne({ where: { groupName: groupName } });
  if (!group) return { status: 901, result: 'group is not exist' };

  const users = await models.user.findAll({
    where: {
      groupId: group.id,
      latestMatchDate: {
        [Op.gte]: daysAgo(60),
      },
    },
  });

  const puuIds = users.map((elem) => elem.puuid);

  const matches = await models.match.findAll({
    where: {
      groupId: group.id,
      winTeam: { [Op.ne]: null },
      createdAt: {
        [Op.gte]: from,
        [Op.lte]: to,
      },
    },
  });

  // 매치 참가자 puuid를 모아서 이름을 한 번에 조회
  const allPuuids = new Set();
  for (const match of matches) {
    const participants = match.team1.concat(match.team2);
    for (const participant of participants) {
      allPuuids.add(participant[0]);
    }
  }
  const summonerRows = await models.summoner.findAll({
    where: { puuid: [...allPuuids] },
    attributes: ['puuid', 'name'],
    raw: true,
  });
  const nameCache = {};
  for (const s of summonerRows) {
    nameCache[s.puuid] = s.name;
  }

  const matchPlayCountMap = {};
  const fixedMatchPlayCountMap = {};
  for (let match of matches) {
    const participants = match.team1.concat(match.team2);
    for (let participant of participants) {
      const puuid = participant[0];
      const name = nameCache[puuid];
      if (!name) continue;

      matchPlayCountMap[name] = (matchPlayCountMap[name] || 0) + 1;

      const weekDay = getKSTIsoWeekday(match.createdAt);
      if (weekDay == 3 || weekDay == 7) {
        fixedMatchPlayCountMap[name] = (fixedMatchPlayCountMap[name] || 0) + 1;
      }
    }
  }

  const riotMatches = await models.riot_match.findAll({
    where: {
      gameCreation: {
        [Op.gte]: from,
        [Op.lte]: to,
      },
    },
  });

  // riotMatch 참가자 중 nameCache에 없는 puuid 추가 조회
  const missingPuuids = new Set();
  for (const match of riotMatches) {
    const filtered = match.participants.filter((elem) => puuIds.includes(elem));
    for (const puuId of filtered) {
      if (nameCache[puuId] == null) missingPuuids.add(puuId);
    }
  }
  if (missingPuuids.size > 0) {
    const extraSummoners = await models.summoner.findAll({
      where: { puuid: [...missingPuuids] },
      attributes: ['puuid', 'name'],
      raw: true,
    });
    for (const s of extraSummoners) {
      nameCache[s.puuid] = s.name;
    }
  }

  const riotMatchSet = {};
  const riotMatchPlayCountMap = {};
  for (let match of riotMatches) {
    const filtered = match.participants.filter((elem) => puuIds.includes(elem));
    if (filtered.length <= 1) continue;

    for (let puuId of filtered) {
      const name = nameCache[puuId];
      if (riotMatchSet[name] == null) {
        riotMatchSet[name] = [];
      }

      const others = filtered.filter((elem) => elem != puuId && !riotMatchSet[name].includes(elem));
      if (others.length == 0) {
        continue;
      }

      riotMatchSet[name].push(...others);
      riotMatchPlayCountMap[name] = (riotMatchPlayCountMap[name] || 0) + others.length;
    }
  }

  let result = [];
  for (let user of users) {
    const name = nameCache[user.puuid];
    if (!name) continue;

    const riotMatchPlayCount = riotMatchPlayCountMap[name] || 0;
    const matchPlayCount = matchPlayCountMap[name] || 0;
    const fixedMatchPlayCount = fixedMatchPlayCountMap[name] || 0;
    const point = matchPlayCount + riotMatchPlayCount;
    result.push({
      name,
      riotMatchPlayCount,
      matchPlayCount,
      fixedMatchPlayCount,
      point,
    });
  }

  result = result.sort((a, b) => b.point - a.point);

  const completedTableConfig = {
    border: table.getBorderCharacters('ramac'),
    columns: {
      0: { alignment: 'center', width: 5 },
      1: { alignment: 'center', width: 20 },
      2: { alignment: 'center', width: 10 },
      3: { alignment: 'center', width: 10 },
      4: { alignment: 'center', width: 10 },
      5: { alignment: 'center', width: 10 },
    },
  };

  const matchCountCondition = 4;
  const riotMatchCountCondition = 8;

  const completedTableData = [['No', '닉네임', '내전', '롤데인', '합산']];
  let rank = 1;
  for (let elem of result.filter(
    (elem) => elem.matchPlayCount >= matchCountCondition || elem.riotMatchPlayCount >= riotMatchCountCondition,
  )) {
    completedTableData.push([rank++, elem.name, elem.matchPlayCount, elem.riotMatchPlayCount, elem.point]);
  }

  const uncompletedTableConfig = {
    border: table.getBorderCharacters('ramac'),
    columns: {
      0: { alignment: 'center', width: 20 },
      1: { alignment: 'center', width: 10 },
      2: { alignment: 'center', width: 10 },
      3: { alignment: 'center', width: 10 },
      4: { alignment: 'center', width: 10 },
    },
  };

  const uncompletedTableData = [['닉네임', '내전', '롤데인', '합산']];
  for (let elem of result.filter(
    (elem) => elem.matchPlayCount < matchCountCondition && elem.riotMatchPlayCount < riotMatchCountCondition,
  )) {
    uncompletedTableData.push([elem.name, elem.matchPlayCount, elem.riotMatchPlayCount, elem.point]);
  }

  let msg = `<pre><h1>달성자</h1>${table.table(
    completedTableData,
    completedTableConfig,
  )}<br><h1>미달성자</h1>${table.table(uncompletedTableData, uncompletedTableConfig)}</pre>`;
  msg = msg.replaceAll('\n', '<br>');

  return {
    result: msg,
    status: 200,
  };
};

module.exports.getMatchHistoryByGroupId = async (groupId, page = 1, limit = 20, search = null) => {
  const group = await models.group.findByPk(groupId);
  if (!group) {
    return { status: 404, result: { error: 'Group not found' } };
  }

  // 검색 조건 구성
  const whereCondition = {
    groupId: group.id,
    winTeam: { [Op.ne]: null },
  };

  if (search) {
    const likeSearch = `%${search}%`;
    whereCondition[Op.or] = [{ team1: { [Op.like]: likeSearch } }, { team2: { [Op.like]: likeSearch } }];
  }

  // 전체 매치 수 조회
  const total = await models.match.count({ where: whereCondition });

  // 페이지네이션 적용 (최신순)
  const offset = (page - 1) * limit;
  const matches = await models.match.findAll({
    where: whereCondition,
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });

  // 소환사 이름 캐시
  const summonerCache = {};
  const getSummonerName = async (puuid) => {
    if (!summonerCache[puuid]) {
      const summoner = await models.summoner.findOne({ where: { puuid }, attributes: ['name'], raw: true });
      summonerCache[puuid] = summoner ? summoner.name : 'Unknown';
    }
    return summonerCache[puuid];
  };

  const matchSnapshots = [];

  for (const match of matches) {
    const team1Data = match.team1;
    const team2Data = match.team2;
    const hasRatingSnapshot = team1Data[0] && team1Data[0].length >= 3;

    if (hasRatingSnapshot) {
      // 저장된 레이팅 스냅샷 사용
      const buildTeamFromSnapshot = async (teamData) => {
        const players = [];
        let totalRating = 0;
        for (const [puuid, name, rating] of teamData) {
          players.push({ puuid, name, rating, tier: formatTier(rating) });
          totalRating += rating;
        }
        return {
          players,
          avgRating: players.length > 0 ? Math.round(totalRating / players.length) : 0,
        };
      };

      const team1 = await buildTeamFromSnapshot(team1Data);
      const team2 = await buildTeamFromSnapshot(team2Data);

      // ratingChange는 팀 평균에서 계산
      let team1RatingChange, team2RatingChange;
      if (match.winTeam === 1) {
        team1RatingChange = ratingCalculator.newRatingIfWon(team1.avgRating, team2.avgRating) - team1.avgRating;
        team2RatingChange = ratingCalculator.newRatingIfLost(team2.avgRating, team1.avgRating) - team2.avgRating;
      } else {
        team1RatingChange = ratingCalculator.newRatingIfLost(team1.avgRating, team2.avgRating) - team1.avgRating;
        team2RatingChange = ratingCalculator.newRatingIfWon(team2.avgRating, team1.avgRating) - team2.avgRating;
      }

      matchSnapshots.push({
        gameId: match.gameId,
        createdAt: match.createdAt,
        winTeam: match.winTeam,
        team1: { players: team1.players, avgRating: team1.avgRating, ratingChange: Math.round(team1RatingChange) },
        team2: { players: team2.players, avgRating: team2.avgRating, ratingChange: Math.round(team2RatingChange) },
      });
    } else {
      // 스냅샷 없는 기존 매치 — 이름만 표시 (레이팅 정보 없음)
      const buildTeamFallback = async (teamData) => {
        const players = [];
        for (const [puuid, name] of teamData) {
          const resolvedName = name || (await getSummonerName(puuid));
          players.push({ puuid, name: resolvedName, rating: null, tier: null });
        }
        return { players, avgRating: null };
      };

      const team1 = await buildTeamFallback(team1Data);
      const team2 = await buildTeamFallback(team2Data);

      matchSnapshots.push({
        gameId: match.gameId,
        createdAt: match.createdAt,
        winTeam: match.winTeam,
        team1: { players: team1.players, avgRating: null, ratingChange: null },
        team2: { players: team2.players, avgRating: null, ratingChange: null },
      });
    }
  }

  return {
    status: 200,
    result: {
      matches: matchSnapshots,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * 3판2선 세트 업적 처리 (역전승/역전패/스윕 승/패)
 * 현재 매치 기준 같은 composition의 최근 24시간 내 매치를 보고 세트 판별
 */
async function processSetAchievements(matchData, userMap, team1Data, team2Data) {
  try {
    const { getCompositionKey } = require('../services/balance-report');
    const currentKey = getCompositionKey(matchData);
    const twentyFourHours = 24 * 60 * 60 * 1000;
    const matchTime = new Date(matchData.createdAt).getTime();

    const recentMatches = await models.match.findAll({
      where: {
        groupId: matchData.groupId,
        winTeam: { [Op.ne]: null },
        gameId: { [Op.lt]: matchData.gameId },
      },
      order: [['gameId', 'DESC']],
      limit: 10,
    });
    const sameSet = recentMatches.filter(
      (m) => getCompositionKey(m) === currentKey
        && matchTime - new Date(m.createdAt).getTime() <= twentyFourHours,
    );

    const winTeamStat = sameSet.length === 1 ? STAT_TYPES.SWEEP_WINS : STAT_TYPES.REVERSE_WINS;
    const loseTeamStat = sameSet.length === 1 ? STAT_TYPES.SWEEP_LOSES : STAT_TYPES.REVERSE_LOSES;
    const winTeamData = matchData.winTeam === 1 ? team1Data : team2Data;
    const loseTeamData = matchData.winTeam === 1 ? team2Data : team1Data;

    let shouldProcess = false;
    if (sameSet.length === 1) {
      // 2경기 세트: 같은 팀 2연승이면 스윕
      shouldProcess = sameSet[0].winTeam === matchData.winTeam;
    } else if (sameSet.length >= 2 && sameSet[0].winTeam !== sameSet[1].winTeam) {
      // 3경기 세트이고 첫 두 경기가 1-1이면 현재 매치가 2-1 역전 결정전
      shouldProcess = true;
    }
    if (!shouldProcess) return;

    const updates = [];
    for (const [puuid] of winTeamData) {
      if (userMap[puuid]) updates.push(statsRepo.incrementStat(puuid, matchData.groupId, winTeamStat));
    }
    for (const [puuid] of loseTeamData) {
      if (userMap[puuid]) updates.push(statsRepo.incrementStat(puuid, matchData.groupId, loseTeamStat));
    }
    await Promise.all(updates);
  } catch (e) {
    logger.error('세트 업적 처리 오류:', e);
  }
}
