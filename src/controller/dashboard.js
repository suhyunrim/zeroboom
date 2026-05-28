const models = require('../db/models');
const { Op } = require('sequelize');
const { logger } = require('../loaders/logger');
const { getKSTYear, getKSTMonth, getKSTMonthRange, getKSTHours } = require('../utils/timeUtils');
const { getHonorTitle } = require('./honor');

/**
 * 대시보드 통계 조회
 * @param {number} groupId - 그룹 ID
 * @param {string} [month] - 조회할 월 (YYYY-MM 형식, 미지정 시 이번 달)
 * @returns {Promise<Object>} 대시보드 데이터
 */
module.exports.getDashboardStats = async (groupId, month) => {
  try {
    // 조회 대상 월 계산
    let year, mon;
    if (month) {
      const [y, m] = month.split('-').map(Number);
      year = y;
      mon = m - 1; // 0-indexed
    } else {
      year = getKSTYear();
      mon = getKSTMonth();
    }
    const { start: monthStart, end: monthEnd } = getKSTMonthRange(year, mon);

    // 이번 달 완료된 매치 조회
    const matches = await models.match.findAll({
      where: {
        groupId,
        winTeam: { [Op.ne]: null },
        createdAt: {
          [Op.between]: [monthStart, monthEnd],
        },
      },
      order: [['createdAt', 'ASC']],
      raw: true,
    });

    if (matches.length === 0) {
      return {
        result: {
          month: `${year}-${String(mon + 1).padStart(2, '0')}`,
          totalMatches: 0,
          mostGames: null,
          bestWinRate: null,
          longestWinStreak: null,
          bestDuo: null,
          mostRivalry: null,
          topNewcomer: null,
          topRatingRiser: null,
          nightOwl: null,
          darkHorse: null,
          honorKing: null,
        },
        status: 200,
      };
    }

    // 유저별 통계 집계
    const userStats = {}; // { puuid: { games, wins, losses, matchHistory, firstRating, lastRating } }
    // 듀오 통계 (같은 팀)
    const duoStats = {}; // { "puuid1|puuid2": { games, wins } }
    // 라이벌 통계 (상대 팀)
    const rivalryStats = {}; // { "puuid1|puuid2": { games, player1Wins, player2Wins } }

    for (const match of matches) {
      const team1 = JSON.parse(match.team1);
      const team2 = JSON.parse(match.team2);
      const winTeam = match.winTeam;
      const createdAt = match.createdAt;
      const hasSnapshot = team1[0] && team1[0].length >= 3;
      const matchHour = getKSTHours(createdAt);
      const isLateNight = matchHour >= 0 && matchHour < 6;

      // 팀 내 최저 레이팅 유저 찾기 (다크호스 계산용)
      let team1MinPuuid = null;
      let team2MinPuuid = null;
      if (hasSnapshot) {
        let team1MinRating = Infinity;
        for (const [puuid, , rating] of team1) {
          if (rating < team1MinRating) { team1MinRating = rating; team1MinPuuid = puuid; }
        }
        let team2MinRating = Infinity;
        for (const [puuid, , rating] of team2) {
          if (rating < team2MinRating) { team2MinRating = rating; team2MinPuuid = puuid; }
        }
      }

      // team1 유저 통계
      for (const player of team1) {
        const puuid = player[0];
        const rating = hasSnapshot ? player[2] : null;
        if (!userStats[puuid]) {
          userStats[puuid] = { games: 0, wins: 0, losses: 0, matchHistory: [], firstRating: rating, lastRating: rating, lateNightGames: 0, darkHorseWins: 0, darkHorseGames: 0 };
        }
        userStats[puuid].games++;
        if (isLateNight) userStats[puuid].lateNightGames++;
        if (puuid === team1MinPuuid) userStats[puuid].darkHorseGames++;
        if (rating !== null) userStats[puuid].lastRating = rating;
        if (winTeam === 1) {
          userStats[puuid].wins++;
          userStats[puuid].matchHistory.push({ won: true, createdAt });
          if (puuid === team1MinPuuid) userStats[puuid].darkHorseWins++;
        } else {
          userStats[puuid].losses++;
          userStats[puuid].matchHistory.push({ won: false, createdAt });
        }
      }

      // team2 유저 통계
      for (const player of team2) {
        const puuid = player[0];
        const rating = hasSnapshot ? player[2] : null;
        if (!userStats[puuid]) {
          userStats[puuid] = { games: 0, wins: 0, losses: 0, matchHistory: [], firstRating: rating, lastRating: rating, lateNightGames: 0, darkHorseWins: 0, darkHorseGames: 0 };
        }
        userStats[puuid].games++;
        if (isLateNight) userStats[puuid].lateNightGames++;
        if (puuid === team2MinPuuid) userStats[puuid].darkHorseGames++;
        if (rating !== null) userStats[puuid].lastRating = rating;
        if (winTeam === 2) {
          userStats[puuid].wins++;
          userStats[puuid].matchHistory.push({ won: true, createdAt });
          if (puuid === team2MinPuuid) userStats[puuid].darkHorseWins++;
        } else {
          userStats[puuid].losses++;
          userStats[puuid].matchHistory.push({ won: false, createdAt });
        }
      }

      // 듀오 통계 (같은 팀 조합)
      const processDuo = (team, won) => {
        const puuids = team.map(([puuid]) => puuid).sort();
        for (let i = 0; i < puuids.length; i++) {
          for (let j = i + 1; j < puuids.length; j++) {
            const key = `${puuids[i]}|${puuids[j]}`;
            if (!duoStats[key]) {
              duoStats[key] = { games: 0, wins: 0, puuid1: puuids[i], puuid2: puuids[j] };
            }
            duoStats[key].games++;
            if (won) duoStats[key].wins++;
          }
        }
      };
      processDuo(team1, winTeam === 1);
      processDuo(team2, winTeam === 2);

      // 라이벌 통계 (상대 팀)
      for (const [puuid1] of team1) {
        for (const [puuid2] of team2) {
          const [p1, p2] = [puuid1, puuid2].sort();
          const key = `${p1}|${p2}`;
          if (!rivalryStats[key]) {
            rivalryStats[key] = { games: 0, puuid1: p1, puuid2: p2, p1Wins: 0, p2Wins: 0 };
          }
          rivalryStats[key].games++;
          // p1이 이겼는지 확인
          if ((winTeam === 1 && p1 === puuid1) || (winTeam === 2 && p1 === puuid2)) {
            rivalryStats[key].p1Wins++;
          } else {
            rivalryStats[key].p2Wins++;
          }
        }
      }
    }

    // outsider 제외
    const outsiders = await models.user.findAll({
      where: { groupId, role: 'outsider' },
      attributes: ['puuid'],
      raw: true,
    });
    const outsiderSet = new Set(outsiders.map((u) => u.puuid));
    outsiderSet.forEach((puuid) => {
      delete userStats[puuid];
    });
    // 듀오/라이벌 통계에서도 outsider 제외
    Object.keys(duoStats).forEach((key) => {
      const duo = duoStats[key];
      if (outsiderSet.has(duo.puuid1) || outsiderSet.has(duo.puuid2)) {
        delete duoStats[key];
      }
    });
    Object.keys(rivalryStats).forEach((key) => {
      const rivalry = rivalryStats[key];
      if (outsiderSet.has(rivalry.puuid1) || outsiderSet.has(rivalry.puuid2)) {
        delete rivalryStats[key];
      }
    });

    // 만료되지 않은 외부 기록 합산 (해당 월 범위 내, 해당 월 말 기준으로 만료 여부 판단)
    const externalRecords = await models.externalRecord.findAll({
      where: {
        groupId,
        expiresAt: { [Op.gt]: monthEnd },
        createdAt: { [Op.between]: [monthStart, monthEnd] },
      },
      raw: true,
    });

    for (const record of externalRecords) {
      const puuid = record.puuid;
      if (outsiderSet.has(puuid)) continue;
      if (!userStats[puuid]) {
        userStats[puuid] = { games: 0, wins: 0, losses: 0, matchHistory: [] };
      }
      userStats[puuid].games += (record.win || 0) + (record.lose || 0);
      userStats[puuid].wins += record.win || 0;
      userStats[puuid].losses += record.lose || 0;
    }

    // 1. 최다 판수 유저
    const mostGamesSorted = Object.entries(userStats)
      .map(([puuid, stats]) => ({ puuid, ...stats }))
      .sort((a, b) => b.games - a.games);
    const mostGamesUser = mostGamesSorted[0] || null;
    const mostGamesRunner = mostGamesSorted[1] || null;

    // 2. N판 이상 최고 승률 (전체 판수의 10%, 최소 3판, 최대 15판)
    const MIN_GAMES_FOR_WINRATE = Math.max(3, Math.min(15, Math.round(matches.length * 0.1)));
    const bestWinRateSorted = Object.entries(userStats)
      .filter(([, stats]) => stats.games >= MIN_GAMES_FOR_WINRATE)
      .map(([puuid, stats]) => ({
        puuid,
        ...stats,
        winRate: (stats.wins / stats.games) * 100,
      }))
      .sort((a, b) => b.winRate - a.winRate || b.games - a.games);
    const bestWinRateUser = bestWinRateSorted[0] || null;
    const bestWinRateRunner = bestWinRateSorted[1] || null;

    // 3. 최다 연승
    const calculateMaxStreak = (matchHistory) => {
      let maxStreak = 0;
      let currentStreak = 0;
      // 시간순 정렬
      const sorted = [...matchHistory].sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
      );
      for (const { won } of sorted) {
        if (won) {
          currentStreak++;
          maxStreak = Math.max(maxStreak, currentStreak);
        } else {
          currentStreak = 0;
        }
      }
      return maxStreak;
    };

    const longestStreakSorted = Object.entries(userStats)
      .map(([puuid, stats]) => ({
        puuid,
        streak: calculateMaxStreak(stats.matchHistory),
      }))
      .sort((a, b) => b.streak - a.streak);
    const longestStreakUser = longestStreakSorted[0] || null;
    const longestStreakRunner = longestStreakSorted[1] || null;

    // 4. N판 이상 2인 조합 최고 승률 (전체 판수의 5%, 최소 2판, 최대 8판)
    const MIN_GAMES_FOR_DUO = Math.max(2, Math.min(8, Math.round(matches.length * 0.05)));
    const bestDuoSorted = Object.values(duoStats)
      .filter((duo) => duo.games >= MIN_GAMES_FOR_DUO)
      .map((duo) => ({
        ...duo,
        losses: duo.games - duo.wins,
        winRate: (duo.wins / duo.games) * 100,
      }))
      .sort((a, b) => b.winRate - a.winRate || b.games - a.games);
    const bestDuo = bestDuoSorted[0] || null;
    const bestDuoRunner = bestDuoSorted[1] || null;

    // 5. 상대 전적 최다 판수
    const mostRivalrySorted = Object.values(rivalryStats).sort((a, b) => b.games - a.games);
    const mostRivalry = mostRivalrySorted[0] || null;
    const mostRivalryRunner = mostRivalrySorted[1] || null;

    // 6. 신규 참가자 최다 판수 (해당 월 말 기준 3주 이내에 첫 매치한 유저)
    const threeWeeksAgo = new Date(monthEnd.getTime() - 21 * 24 * 60 * 60 * 1000);

    // users 테이블의 firstMatchDate로 신규 참가자 판별
    const newcomers = await models.user.findAll({
      where: {
        groupId,
        role: { [Op.ne]: 'outsider' },
        leftGuildAt: null,
        firstMatchDate: { [Op.gte]: threeWeeksAgo },
      },
      attributes: ['puuid', 'firstMatchDate'],
      raw: true,
    });

    const newcomerMap = {};
    for (const u of newcomers) {
      newcomerMap[u.puuid] = u.firstMatchDate;
    }

    const topNewcomerSorted = Object.entries(userStats)
      .filter(([puuid]) => newcomerMap[puuid])
      .map(([puuid, stats]) => ({
        puuid,
        games: stats.games,
        firstMatchDate: newcomerMap[puuid],
      }))
      .sort((a, b) => b.games - a.games);
    const topNewcomer = topNewcomerSorted[0] || null;
    const topNewcomerRunner = topNewcomerSorted[1] || null;

    // 7. 이달의 레이팅 상승왕 (firstRating → lastRating 변화량이 가장 큰 유저)
    const topRatingRiserSorted = Object.entries(userStats)
      .filter(([, stats]) => stats.firstRating !== null && stats.lastRating !== null)
      .map(([puuid, stats]) => ({
        puuid,
        ratingChange: stats.lastRating - stats.firstRating,
        startRating: stats.firstRating,
        endRating: stats.lastRating,
        games: stats.games,
      }))
      .sort((a, b) => b.ratingChange - a.ratingChange);
    const topRatingRiser = topRatingRiserSorted[0] || null;
    const topRatingRiserRunner = topRatingRiserSorted[1] || null;

    // 8. 새벽 전사 (새벽 0~6시 경기 비율이 가장 높은 유저, 전체 판수의 10% 이상만)
    const MIN_GAMES_FOR_LATE_NIGHT = Math.max(2, Math.round(matches.length * 0.1));
    const nightOwlSorted = Object.entries(userStats)
      .filter(([, stats]) => stats.lateNightGames > 0 && stats.games >= MIN_GAMES_FOR_LATE_NIGHT)
      .map(([puuid, stats]) => ({
        puuid,
        lateNightGames: stats.lateNightGames,
        games: stats.games,
        lateNightRate: (stats.lateNightGames / stats.games) * 100,
      }))
      .sort((a, b) => b.lateNightRate - a.lateNightRate || b.lateNightGames - a.lateNightGames);
    const nightOwl = nightOwlSorted[0] || null;
    const nightOwlRunner = nightOwlSorted[1] || null;

    // 9. 다크호스 (팀 내 최저 레이팅이었는데 팀이 이긴 횟수가 가장 많은 유저)
    const darkHorseSorted = Object.entries(userStats)
      .filter(([, stats]) => stats.darkHorseGames > 0 && stats.darkHorseWins > stats.darkHorseGames / 2)
      .map(([puuid, stats]) => ({
        puuid,
        darkHorseWins: stats.darkHorseWins,
        darkHorseGames: stats.darkHorseGames,
        darkHorseWinRate: (stats.darkHorseWins / stats.darkHorseGames) * 100,
        games: stats.games,
      }))
      .sort((a, b) => b.darkHorseWins - a.darkHorseWins || b.darkHorseWinRate - a.darkHorseWinRate);
    const darkHorse = darkHorseSorted[0] || null;
    const darkHorseRunner = darkHorseSorted[1] || null;

    // 10. 명예왕 (해당 월 가장 많이 MVP 투표를 받은 유저)
    const honorVotes = await models.honor_vote.findAll({
      where: {
        groupId,
        createdAt: { [Op.between]: [monthStart, monthEnd] },
      },
      raw: true,
    });

    const honorCounts = {};
    for (const vote of honorVotes) {
      if (!honorCounts[vote.targetPuuid]) {
        honorCounts[vote.targetPuuid] = 0;
      }
      honorCounts[vote.targetPuuid]++;
    }

    // honorCounts에서도 outsider 제외
    outsiderSet.forEach((puuid) => {
      delete honorCounts[puuid];
    });

    const honorSorted = Object.entries(honorCounts).sort((a, b) => b[1] - a[1]);
    const honorKingEntry = honorSorted[0] || null;
    const honorKingRunner = honorSorted[1] || null;

    // 명예왕의 누적 투표 수 조회 (칭호용)
    let honorKingTotalVotes = 0;
    let honorRunnerTotalVotes = 0;
    if (honorKingEntry) {
      honorKingTotalVotes = await models.honor_vote.count({
        where: { groupId, targetPuuid: honorKingEntry[0] },
      });
    }
    if (honorKingRunner) {
      honorRunnerTotalVotes = await models.honor_vote.count({
        where: { groupId, targetPuuid: honorKingRunner[0] },
      });
    }

    // 필요한 puuid를 모아서 이름을 한 번에 조회 (1등 + 2등)
    const puuidsToResolve = new Set();
    const addUserPuuid = (u) => { if (u) puuidsToResolve.add(u.puuid); };
    const addDuoPuuids = (d) => { if (d) { puuidsToResolve.add(d.puuid1); puuidsToResolve.add(d.puuid2); } };
    [mostGamesUser, mostGamesRunner, bestWinRateUser, bestWinRateRunner,
      longestStreakUser, longestStreakRunner, topNewcomer, topNewcomerRunner,
      topRatingRiser, topRatingRiserRunner, nightOwl, nightOwlRunner,
      darkHorse, darkHorseRunner].forEach(addUserPuuid);
    [bestDuo, bestDuoRunner, mostRivalry, mostRivalryRunner].forEach(addDuoPuuids);
    if (honorKingEntry) puuidsToResolve.add(honorKingEntry[0]);
    if (honorKingRunner) puuidsToResolve.add(honorKingRunner[0]);

    const summonerRows = puuidsToResolve.size > 0
      ? await models.summoner.findAll({
          where: { puuid: [...puuidsToResolve] },
          attributes: ['puuid', 'name'],
          raw: true,
        })
      : [];
    const nameMap = {};
    for (const s of summonerRows) {
      nameMap[s.puuid] = s.name;
    }
    const getName = (puuid) => nameMap[puuid] || 'Unknown';

    // 카드별 매핑 함수 (1등/2등에 동일하게 적용)
    const toMostGames = (u) => ({
      puuid: u.puuid,
      name: getName(u.puuid),
      games: u.games,
      wins: u.wins,
      losses: u.losses,
      winRate: Number(((u.wins / u.games) * 100).toFixed(1)),
    });
    const toBestWinRate = (u) => ({
      puuid: u.puuid,
      name: getName(u.puuid),
      games: u.games,
      wins: u.wins,
      losses: u.losses,
      winRate: Number(u.winRate.toFixed(1)),
    });
    const toLongestStreak = (u) => ({
      puuid: u.puuid,
      name: getName(u.puuid),
      streak: u.streak,
    });
    const toBestDuo = (d) => ({
      puuid1: d.puuid1,
      name1: getName(d.puuid1),
      puuid2: d.puuid2,
      name2: getName(d.puuid2),
      games: d.games,
      wins: d.wins,
      losses: d.losses,
      winRate: Number(d.winRate.toFixed(1)),
    });
    const toMostRivalry = (r) => ({
      puuid1: r.puuid1,
      name1: getName(r.puuid1),
      puuid2: r.puuid2,
      name2: getName(r.puuid2),
      games: r.games,
      player1Wins: r.p1Wins,
      player2Wins: r.p2Wins,
    });
    const toTopNewcomer = (u) => ({
      puuid: u.puuid,
      name: getName(u.puuid),
      games: u.games,
      firstMatchDate: u.firstMatchDate,
    });
    const toTopRatingRiser = (u) => ({
      puuid: u.puuid,
      name: getName(u.puuid),
      ratingChange: u.ratingChange,
      startRating: u.startRating,
      endRating: u.endRating,
      games: u.games,
    });
    const toNightOwl = (u) => ({
      puuid: u.puuid,
      name: getName(u.puuid),
      lateNightGames: u.lateNightGames,
      games: u.games,
      lateNightRate: Number(u.lateNightRate.toFixed(1)),
    });
    const toDarkHorse = (u) => ({
      puuid: u.puuid,
      name: getName(u.puuid),
      darkHorseWins: u.darkHorseWins,
      darkHorseGames: u.darkHorseGames,
      darkHorseWinRate: Number(u.darkHorseWinRate.toFixed(1)),
      games: u.games,
    });
    const toHonorKing = (entry, totalVotes) => ({
      puuid: entry[0],
      name: getName(entry[0]),
      votes: entry[1],
      title: getHonorTitle(totalVotes),
    });

    // 1등 카드에 runnerUp을 조건부로 합치는 헬퍼
    const withRunner = (extra, runner, toCard) =>
      runner ? { ...extra, runnerUp: toCard(runner) } : extra;

    // 결과 조합
    const result = {
      month: `${year}-${String(mon + 1).padStart(2, '0')}`,
      totalMatches: matches.length,
      mostGames: mostGamesUser
        ? { type: 'most_games', ...withRunner(toMostGames(mostGamesUser), mostGamesRunner, toMostGames) }
        : null,
      bestWinRate: bestWinRateUser
        ? {
            type: 'best_win_rate',
            minGames: MIN_GAMES_FOR_WINRATE,
            ...withRunner(toBestWinRate(bestWinRateUser), bestWinRateRunner, toBestWinRate),
          }
        : null,
      longestWinStreak:
        longestStreakUser && longestStreakUser.streak > 0
          ? {
              type: 'longest_win_streak',
              ...withRunner(
                toLongestStreak(longestStreakUser),
                longestStreakRunner && longestStreakRunner.streak > 0 ? longestStreakRunner : null,
                toLongestStreak,
              ),
            }
          : null,
      bestDuo: bestDuo
        ? {
            type: 'best_duo',
            minGames: MIN_GAMES_FOR_DUO,
            ...withRunner(toBestDuo(bestDuo), bestDuoRunner, toBestDuo),
          }
        : null,
      mostRivalry: mostRivalry
        ? { type: 'most_rivalry', ...withRunner(toMostRivalry(mostRivalry), mostRivalryRunner, toMostRivalry) }
        : null,
      topNewcomer: topNewcomer
        ? { type: 'top_newcomer', ...withRunner(toTopNewcomer(topNewcomer), topNewcomerRunner, toTopNewcomer) }
        : null,
      topRatingRiser: topRatingRiser
        ? {
            type: 'top_rating_riser',
            ...withRunner(toTopRatingRiser(topRatingRiser), topRatingRiserRunner, toTopRatingRiser),
          }
        : null,
      nightOwl: nightOwl
        ? { type: 'night_owl', ...withRunner(toNightOwl(nightOwl), nightOwlRunner, toNightOwl) }
        : null,
      darkHorse: darkHorse
        ? { type: 'dark_horse', ...withRunner(toDarkHorse(darkHorse), darkHorseRunner, toDarkHorse) }
        : null,
      honorKing: honorKingEntry
        ? {
            type: 'honor_king',
            ...toHonorKing(honorKingEntry, honorKingTotalVotes),
            ...(honorKingRunner && { runnerUp: toHonorKing(honorKingRunner, honorRunnerTotalVotes) }),
          }
        : null,
    };

    return { result, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 500 };
  }
};
