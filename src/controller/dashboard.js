const models = require('../db/models');
const { Op } = require('sequelize');
const { logger } = require('../loaders/logger');

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
      const now = new Date();
      year = now.getFullYear();
      mon = now.getMonth();
    }
    const monthStart = new Date(year, mon, 1);
    const monthEnd = new Date(year, mon + 1, 0, 23, 59, 59);

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
        },
        status: 200,
      };
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
      const kstDate = new Date(new Date(createdAt).getTime() + 9 * 60 * 60 * 1000);
      const matchHour = kstDate.getUTCHours();
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
      if (!userStats[puuid]) {
        userStats[puuid] = { games: 0, wins: 0, losses: 0, matchHistory: [] };
      }
      userStats[puuid].games += (record.win || 0) + (record.lose || 0);
      userStats[puuid].wins += record.win || 0;
      userStats[puuid].losses += record.lose || 0;
    }

    // 1. 최다 판수 유저
    const mostGamesUser = Object.entries(userStats).reduce(
      (max, [puuid, stats]) => (stats.games > (max?.games || 0) ? { puuid, ...stats } : max),
      null
    );

    // 2. N판 이상 최고 승률 (전체 판수의 10%, 최소 3판, 최대 15판)
    const MIN_GAMES_FOR_WINRATE = Math.max(3, Math.min(15, Math.round(matches.length * 0.1)));
    const bestWinRateUser = Object.entries(userStats)
      .filter(([, stats]) => stats.games >= MIN_GAMES_FOR_WINRATE)
      .map(([puuid, stats]) => ({
        puuid,
        ...stats,
        winRate: (stats.wins / stats.games) * 100,
      }))
      .sort((a, b) => b.winRate - a.winRate || b.games - a.games)[0] || null;

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

    const longestStreakUser = Object.entries(userStats)
      .map(([puuid, stats]) => ({
        puuid,
        streak: calculateMaxStreak(stats.matchHistory),
      }))
      .sort((a, b) => b.streak - a.streak)[0] || null;

    // 4. N판 이상 2인 조합 최고 승률 (전체 판수의 5%, 최소 2판, 최대 8판)
    const MIN_GAMES_FOR_DUO = Math.max(2, Math.min(8, Math.round(matches.length * 0.05)));
    const bestDuo = Object.values(duoStats)
      .filter((duo) => duo.games >= MIN_GAMES_FOR_DUO)
      .map((duo) => ({
        ...duo,
        losses: duo.games - duo.wins,
        winRate: (duo.wins / duo.games) * 100,
      }))
      .sort((a, b) => b.winRate - a.winRate || b.games - a.games)[0] || null;

    // 5. 상대 전적 최다 판수
    const mostRivalry = Object.values(rivalryStats).sort((a, b) => b.games - a.games)[0] || null;

    // 6. 신규 참가자 최다 판수 (해당 월 말 기준 3주 이내에 첫 매치한 유저)
    const threeWeeksAgo = new Date(monthEnd.getTime() - 21 * 24 * 60 * 60 * 1000);

    // users 테이블의 firstMatchDate로 신규 참가자 판별
    const newcomers = await models.user.findAll({
      where: {
        groupId,
        firstMatchDate: { [Op.gte]: threeWeeksAgo },
      },
      attributes: ['puuid', 'firstMatchDate'],
      raw: true,
    });

    const newcomerMap = {};
    for (const u of newcomers) {
      newcomerMap[u.puuid] = u.firstMatchDate;
    }

    const topNewcomer = Object.entries(userStats)
      .filter(([puuid]) => newcomerMap[puuid])
      .map(([puuid, stats]) => ({
        puuid,
        games: stats.games,
        firstMatchDate: newcomerMap[puuid],
      }))
      .sort((a, b) => b.games - a.games)[0] || null;

    // 7. 이달의 레이팅 상승왕 (firstRating → lastRating 변화량이 가장 큰 유저)
    const topRatingRiser = Object.entries(userStats)
      .filter(([, stats]) => stats.firstRating !== null && stats.lastRating !== null)
      .map(([puuid, stats]) => ({
        puuid,
        ratingChange: stats.lastRating - stats.firstRating,
        startRating: stats.firstRating,
        endRating: stats.lastRating,
        games: stats.games,
      }))
      .sort((a, b) => b.ratingChange - a.ratingChange)[0] || null;

    // 8. 새벽 전사 (새벽 0~6시 경기 비율이 가장 높은 유저, 전체 판수의 10% 이상만)
    const MIN_GAMES_FOR_LATE_NIGHT = Math.max(2, Math.round(matches.length * 0.1));
    const nightOwl = Object.entries(userStats)
      .filter(([, stats]) => stats.lateNightGames > 0 && stats.games >= MIN_GAMES_FOR_LATE_NIGHT)
      .map(([puuid, stats]) => ({
        puuid,
        lateNightGames: stats.lateNightGames,
        games: stats.games,
        lateNightRate: (stats.lateNightGames / stats.games) * 100,
      }))
      .sort((a, b) => b.lateNightRate - a.lateNightRate || b.lateNightGames - a.lateNightGames)[0] || null;

    // 9. 다크호스 (팀 내 최저 레이팅이었는데 팀이 이긴 횟수가 가장 많은 유저)
    const darkHorse = Object.entries(userStats)
      .filter(([, stats]) => stats.darkHorseGames > 0 && stats.darkHorseWins > stats.darkHorseGames / 2)
      .map(([puuid, stats]) => ({
        puuid,
        darkHorseWins: stats.darkHorseWins,
        darkHorseGames: stats.darkHorseGames,
        darkHorseWinRate: (stats.darkHorseWins / stats.darkHorseGames) * 100,
        games: stats.games,
      }))
      .sort((a, b) => b.darkHorseWins - a.darkHorseWins || b.darkHorseWinRate - a.darkHorseWinRate)[0] || null;

    // 결과 조합
    const result = {
      month: `${year}-${String(mon + 1).padStart(2, '0')}`,
      totalMatches: matches.length,
      mostGames: mostGamesUser
        ? {
            type: 'most_games',
            puuid: mostGamesUser.puuid,
            name: await getName(mostGamesUser.puuid),
            games: mostGamesUser.games,
            wins: mostGamesUser.wins,
            losses: mostGamesUser.losses,
            winRate: Number(((mostGamesUser.wins / mostGamesUser.games) * 100).toFixed(1)),
          }
        : null,
      bestWinRate: bestWinRateUser
        ? {
            type: 'best_win_rate',
            minGames: MIN_GAMES_FOR_WINRATE,
            puuid: bestWinRateUser.puuid,
            name: await getName(bestWinRateUser.puuid),
            games: bestWinRateUser.games,
            wins: bestWinRateUser.wins,
            losses: bestWinRateUser.losses,
            winRate: Number(bestWinRateUser.winRate.toFixed(1)),
          }
        : null,
      longestWinStreak:
        longestStreakUser && longestStreakUser.streak > 0
          ? {
              type: 'longest_win_streak',
              puuid: longestStreakUser.puuid,
              name: await getName(longestStreakUser.puuid),
              streak: longestStreakUser.streak,
            }
          : null,
      bestDuo: bestDuo
        ? {
            type: 'best_duo',
            minGames: MIN_GAMES_FOR_DUO,
            puuid1: bestDuo.puuid1,
            name1: await getName(bestDuo.puuid1),
            puuid2: bestDuo.puuid2,
            name2: await getName(bestDuo.puuid2),
            games: bestDuo.games,
            wins: bestDuo.wins,
            losses: bestDuo.losses,
            winRate: Number(bestDuo.winRate.toFixed(1)),
          }
        : null,
      mostRivalry: mostRivalry
        ? {
            type: 'most_rivalry',
            puuid1: mostRivalry.puuid1,
            name1: await getName(mostRivalry.puuid1),
            puuid2: mostRivalry.puuid2,
            name2: await getName(mostRivalry.puuid2),
            games: mostRivalry.games,
            player1Wins: mostRivalry.p1Wins,
            player2Wins: mostRivalry.p2Wins,
          }
        : null,
      topNewcomer: topNewcomer
        ? {
            type: 'top_newcomer',
            puuid: topNewcomer.puuid,
            name: await getName(topNewcomer.puuid),
            games: topNewcomer.games,
            firstMatchDate: topNewcomer.firstMatchDate,
          }
        : null,
      topRatingRiser: topRatingRiser
        ? {
            type: 'top_rating_riser',
            puuid: topRatingRiser.puuid,
            name: await getName(topRatingRiser.puuid),
            ratingChange: topRatingRiser.ratingChange,
            startRating: topRatingRiser.startRating,
            endRating: topRatingRiser.endRating,
            games: topRatingRiser.games,
          }
        : null,
      nightOwl: nightOwl
        ? {
            type: 'night_owl',
            puuid: nightOwl.puuid,
            name: await getName(nightOwl.puuid),
            lateNightGames: nightOwl.lateNightGames,
            games: nightOwl.games,
            lateNightRate: Number(nightOwl.lateNightRate.toFixed(1)),
          }
        : null,
      darkHorse: darkHorse
        ? {
            type: 'dark_horse',
            puuid: darkHorse.puuid,
            name: await getName(darkHorse.puuid),
            darkHorseWins: darkHorse.darkHorseWins,
            darkHorseGames: darkHorse.darkHorseGames,
            darkHorseWinRate: Number(darkHorse.darkHorseWinRate.toFixed(1)),
            games: darkHorse.games,
          }
        : null,
    };

    return { result, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 500 };
  }
};
