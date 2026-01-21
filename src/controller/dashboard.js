const models = require('../db/models');
const { Op } = require('sequelize');
const { logger } = require('../loaders/logger');

/**
 * 이번 달 대시보드 통계 조회
 * @param {number} groupId - 그룹 ID
 * @returns {Promise<Object>} 대시보드 데이터
 */
module.exports.getDashboardStats = async (groupId) => {
  try {
    // 이번 달 시작/끝 날짜 계산
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

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
          month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
          totalMatches: 0,
          mostGames: null,
          bestWinRate: null,
          longestWinStreak: null,
          bestDuo: null,
          mostRivalry: null,
          topNewcomer: null,
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
    const userStats = {}; // { puuid: { games, wins, losses, matchHistory: [{won: bool, createdAt}] } }
    // 듀오 통계 (같은 팀)
    const duoStats = {}; // { "puuid1|puuid2": { games, wins } }
    // 라이벌 통계 (상대 팀)
    const rivalryStats = {}; // { "puuid1|puuid2": { games, player1Wins, player2Wins } }

    for (const match of matches) {
      const team1 = JSON.parse(match.team1);
      const team2 = JSON.parse(match.team2);
      const winTeam = match.winTeam;
      const createdAt = match.createdAt;

      // team1 유저 통계
      for (const [puuid] of team1) {
        if (!userStats[puuid]) {
          userStats[puuid] = { games: 0, wins: 0, losses: 0, matchHistory: [] };
        }
        userStats[puuid].games++;
        if (winTeam === 1) {
          userStats[puuid].wins++;
          userStats[puuid].matchHistory.push({ won: true, createdAt });
        } else {
          userStats[puuid].losses++;
          userStats[puuid].matchHistory.push({ won: false, createdAt });
        }
      }

      // team2 유저 통계
      for (const [puuid] of team2) {
        if (!userStats[puuid]) {
          userStats[puuid] = { games: 0, wins: 0, losses: 0, matchHistory: [] };
        }
        userStats[puuid].games++;
        if (winTeam === 2) {
          userStats[puuid].wins++;
          userStats[puuid].matchHistory.push({ won: true, createdAt });
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

    // 1. 최다 판수 유저
    const mostGamesUser = Object.entries(userStats).reduce(
      (max, [puuid, stats]) => (stats.games > (max?.games || 0) ? { puuid, ...stats } : max),
      null
    );

    // 2. N판 이상 최고 승률 (최소 5판)
    const MIN_GAMES_FOR_WINRATE = 5;
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

    // 4. N판 이상 2인 조합 최고 승률 (최소 3판)
    const MIN_GAMES_FOR_DUO = 3;
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

    // 6. 신규 참가자 최다 판수 (첫 매치가 최근 3주 이내인 유저)
    const threeWeeksAgo = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);

    // 그룹 내 모든 완료된 매치에서 각 유저의 첫 매치 날짜 조회
    const allMatches = await models.match.findAll({
      where: {
        groupId,
        winTeam: { [Op.ne]: null },
      },
      attributes: ['team1', 'team2', 'createdAt'],
      order: [['createdAt', 'ASC']],
      raw: true,
    });

    // 각 유저의 첫 매치 날짜 계산
    const firstMatchDateMap = {}; // { puuid: Date }
    for (const match of allMatches) {
      const team1 = JSON.parse(match.team1);
      const team2 = JSON.parse(match.team2);
      const createdAt = new Date(match.createdAt);

      for (const [puuid] of [...team1, ...team2]) {
        if (!firstMatchDateMap[puuid]) {
          firstMatchDateMap[puuid] = createdAt;
        }
      }
    }

    // 첫 매치가 최근 3주 이내인 유저 필터링
    const newUserPuuids = new Set(
      Object.entries(firstMatchDateMap)
        .filter(([, date]) => date >= threeWeeksAgo)
        .map(([puuid]) => puuid)
    );

    const topNewcomer = Object.entries(userStats)
      .filter(([puuid]) => newUserPuuids.has(puuid))
      .map(([puuid, stats]) => ({
        puuid,
        games: stats.games,
        firstMatchDate: firstMatchDateMap[puuid],
      }))
      .sort((a, b) => b.games - a.games)[0] || null;

    // 결과 조합
    const result = {
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
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
    };

    return { result, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 500 };
  }
};
