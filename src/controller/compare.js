const { Op } = require('sequelize');
const Elo = require('arpad');
const models = require('../db/models');

// applyMatchResult와 동일한 K-factor — 재계산한 delta가 실제 적용값과 일치해야 함
const ratingCalculator = new Elo(16);

// 둘 다와의 시너지 리스트 자격: A/B 각각과 같은 팀으로 최소 이 판수 이상
const MIN_GAMES_FOR_MUTUAL = 5;
const MUTUAL_LIST_COUNT = 3;
const MATCH_LIST_COUNT = 20;
const RECENT_VS_COUNT = 10;
const RATING_TRAJECTORY_MATCH_COUNT = 100;

// 내전 포지션 키 (유저 상세와 동일, Riot 표준)
const POSITION_KEYS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const VALID_POSITIONS = new Set(POSITION_KEYS);

// 관계 타이틀 기준 (표시 승률 = 반올림 값 기준)
const NATURAL_ENEMY_MIN_GAMES = 10; // 천적: 맞대결 10판+ & 한쪽 승률 65%+
const NATURAL_ENEMY_WIN_RATE = 65;
const RIVAL_MIN_GAMES = 20; // 숙명의 라이벌: 맞대결 20판+ & 45~55%
const RIVAL_WIN_RATE_MIN = 45;
const RIVAL_WIN_RATE_MAX = 55;
const DUO_MIN_GAMES = 10; // 환상의 듀오: 같은팀 10판+ & 승률 60%+
const DUO_WIN_RATE = 60;
const LOVE_HATE_MIN_GAMES = 10; // 애증의 관계: 맞대결·같은팀 모두 10판+

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const toKstMonthKey = (date) => {
  const kst = new Date(new Date(date).getTime() + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
};
const toKstDateKey = (date) => {
  const kst = new Date(new Date(date).getTime() + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(
    2,
    '0',
  )}`;
};

// 레이팅 궤적: 최근 N판을 KST 일 단위로 묶음 (같은 날은 마지막 매치 레이팅) — 유저 상세와 동일 방식
const toDailyRatingHistory = (history) => {
  const daily = new Map();
  for (const entry of history.slice(-RATING_TRAJECTORY_MATCH_COUNT)) {
    daily.set(toKstDateKey(entry.createdAt), entry.rating);
  }
  return [...daily.entries()].map(([date, rating]) => ({ date, rating }));
};

/**
 * 두 유저 비교: 상대전적 / 같은팀 시너지 / 타임라인 / 점수 이동 / 둘 다와의 시너지 리스트
 * @param {number} groupId
 * @param {string} puuidA
 * @param {string} puuidB
 * @returns {Promise<{status: number, result: Object|string}>}
 */
module.exports.compareUsers = async (groupId, puuidA, puuidB) => {
  const [users, matches] = await Promise.all([
    models.user.findAll({ where: { groupId, puuid: [puuidA, puuidB] }, raw: true }),
    models.match.findAll({
      where: { groupId, winTeam: { [Op.ne]: null } },
      order: [['createdAt', 'ASC']],
      raw: true,
    }),
  ]);

  const userA = users.find((u) => u.puuid === puuidA);
  const userB = users.find((u) => u.puuid === puuidB);
  if (!userA || !userB) {
    return { status: 404, result: '두 유저 모두 그룹에 등록되어 있어야 합니다.' };
  }

  // 개인 통산(확정 매치 기준) — 같은팀 시너지 기대치 계산용
  const overall = { a: { games: 0, wins: 0 }, b: { games: 0, wins: 0 } };
  // 같은 팀 동료 집계 — 둘 다와의 시너지 리스트용
  const teammatesOfA = {}; // { puuid: { games, wins } }
  const teammatesOfB = {};
  const vs = { games: 0, aWins: 0, bWins: 0 };
  const vsResults = []; // 시간순 [{ aWon }]
  const together = { games: 0, wins: 0 };
  // 맞대결에서 오간 레이팅 (확정 시 적용된 delta를 스냅샷으로 재계산)
  let takenByA = 0;
  let takenByB = 0;
  let ratingComputedGames = 0;
  let ratingSkippedGames = 0;
  let firstVs = null;
  let firstTogether = null;
  let lastMetAt = null;
  const monthly = new Map(); // 'YYYY-MM'(KST) -> 얽힌 경기 수
  const entangled = []; // 두 명 모두 참여한 경기
  // 레이팅 궤적 (각자 참여한 매치의 스냅샷 레이팅, 시간순)
  const aRatingHistory = []; // [{ rating, createdAt }]
  const bRatingHistory = [];
  // 맞라인 전적: 둘 다 포지션이 있고 같은 포지션으로 맞팀인 경기
  const laneAcc = {}; // { POSITION: { games, aWins, bWins } }

  for (const match of matches) {
    const team1 = JSON.parse(match.team1);
    const team2 = JSON.parse(match.team2);
    const { winTeam, createdAt, gameId } = match;

    const findSide = (puuid) => (team1.some((p) => p[0] === puuid) ? 1 : team2.some((p) => p[0] === puuid) ? 2 : null);
    const aTeam = findSide(puuidA);
    const bTeam = findSide(puuidB);

    const accumulateTeammates = (map, myPuuid, myTeamNo) => {
      const myTeam = myTeamNo === 1 ? team1 : team2;
      const won = winTeam === myTeamNo;
      for (const [puuid] of myTeam) {
        if (puuid === myPuuid) continue;
        if (!map[puuid]) map[puuid] = { games: 0, wins: 0 };
        map[puuid].games++;
        if (won) map[puuid].wins++;
      }
    };

    let aPlayer = null;
    let bPlayer = null;
    if (aTeam) {
      overall.a.games++;
      if (winTeam === aTeam) overall.a.wins++;
      accumulateTeammates(teammatesOfA, puuidA, aTeam);
      aPlayer = (aTeam === 1 ? team1 : team2).find((p) => p[0] === puuidA);
      if (typeof aPlayer[2] === 'number') aRatingHistory.push({ rating: aPlayer[2], createdAt });
    }
    if (bTeam) {
      overall.b.games++;
      if (winTeam === bTeam) overall.b.wins++;
      accumulateTeammates(teammatesOfB, puuidB, bTeam);
      bPlayer = (bTeam === 1 ? team1 : team2).find((p) => p[0] === puuidB);
      if (typeof bPlayer[2] === 'number') bRatingHistory.push({ rating: bPlayer[2], createdAt });
    }
    if (!aTeam || !bTeam) continue;

    // === 두 명이 모두 참여한 경기 ===
    const aRating = typeof aPlayer[2] === 'number' ? aPlayer[2] : null;
    const bRating = typeof bPlayer[2] === 'number' ? bPlayer[2] : null;
    const aPosition = VALID_POSITIONS.has(aPlayer[3]) ? aPlayer[3] : null;
    const bPosition = VALID_POSITIONS.has(bPlayer[3]) ? bPlayer[3] : null;
    const sameTeam = aTeam === bTeam;
    const aWon = winTeam === aTeam;
    const bWon = winTeam === bTeam;

    if (sameTeam) {
      together.games++;
      if (aWon) together.wins++;
      if (!firstTogether) {
        firstTogether = { gameId, date: createdAt, won: aWon, aRating, bRating };
      }
    } else {
      vs.games++;
      if (aWon) vs.aWins++;
      else vs.bWins++;
      vsResults.push({ aWon });
      if (!firstVs) {
        firstVs = { gameId, date: createdAt, winner: aWon ? 'A' : 'B', aRating, bRating };
      }

      // 맞라인: 같은 포지션으로 맞팀에 선 경기
      if (aPosition && aPosition === bPosition) {
        if (!laneAcc[aPosition]) laneAcc[aPosition] = { games: 0, aWins: 0, bWins: 0 };
        laneAcc[aPosition].games++;
        if (aWon) laneAcc[aPosition].aWins++;
        else laneAcc[aPosition].bWins++;
      }

      // 스냅샷 레이팅이 전원 있어야 확정 시 적용된 delta와 동일하게 재계산 가능
      const allRated = [...team1, ...team2].every((p) => typeof p[2] === 'number');
      if (allRated) {
        const avg1 = team1.reduce((sum, p) => sum + p[2], 0) / team1.length;
        const avg2 = team2.reduce((sum, p) => sum + p[2], 0) / team2.length;
        const winnerAvg = winTeam === 1 ? avg1 : avg2;
        const loserAvg = winTeam === 1 ? avg2 : avg1;
        const winnerDelta = ratingCalculator.newRatingIfWon(winnerAvg, loserAvg) - winnerAvg;
        if (aWon) takenByA += winnerDelta;
        else takenByB += winnerDelta;
        ratingComputedGames++;
      } else {
        ratingSkippedGames++;
      }
    }

    lastMetAt = createdAt;
    const monthKey = toKstMonthKey(createdAt);
    monthly.set(monthKey, (monthly.get(monthKey) || 0) + 1);
    entangled.push({
      gameId,
      date: createdAt,
      sameTeam,
      aWon,
      bWon,
      aRating,
      bRating,
      aPosition,
      bPosition,
    });
  }

  // 둘 다와의 시너지 후보: 유저 상세와 같은 기준으로 외부인/떠난 멤버는 리스트에서 제외
  const excludedUsers = await models.user.findAll({
    where: {
      groupId,
      [Op.or]: [{ role: 'outsider' }, { leftGuildAt: { [Op.ne]: null } }],
    },
    attributes: ['puuid'],
    raw: true,
  });
  const excluded = new Set(excludedUsers.map((u) => u.puuid));

  const mutualCandidates = [];
  for (const [puuid, withA] of Object.entries(teammatesOfA)) {
    if (puuid === puuidB || excluded.has(puuid)) continue;
    const withB = teammatesOfB[puuid];
    if (!withB) continue;
    if (withA.games < MIN_GAMES_FOR_MUTUAL || withB.games < MIN_GAMES_FOR_MUTUAL) continue;
    const winRateA = (withA.wins / withA.games) * 100;
    const winRateB = (withB.wins / withB.games) * 100;
    mutualCandidates.push({
      puuid,
      withA: { games: withA.games, wins: withA.wins, winRate: Math.round(winRateA) },
      withB: { games: withB.games, wins: withB.wins, winRate: Math.round(winRateB) },
      avgWinRate: (winRateA + winRateB) / 2,
      totalGames: withA.games + withB.games,
    });
  }

  // 유저 상세 best/worst와 같은 경계: "좋음"은 양쪽 다 표시 승률 51% 이상, "나쁨"은 49% 이하
  const goodWithBoth = mutualCandidates
    .filter((c) => c.withA.winRate >= 51 && c.withB.winRate >= 51)
    .sort((x, y) => y.avgWinRate - x.avgWinRate || y.totalGames - x.totalGames)
    .slice(0, MUTUAL_LIST_COUNT);
  const badWithBoth = mutualCandidates
    .filter((c) => c.withA.winRate <= 49 && c.withB.winRate <= 49)
    .sort((x, y) => x.avgWinRate - y.avgWinRate || y.totalGames - x.totalGames)
    .slice(0, MUTUAL_LIST_COUNT);

  const namePuuids = new Set([puuidA, puuidB, ...goodWithBoth.map((c) => c.puuid), ...badWithBoth.map((c) => c.puuid)]);
  const [summoners, externalRecords] = await Promise.all([
    models.summoner.findAll({
      where: { puuid: [...namePuuids] },
      attributes: ['puuid', 'name', 'rankTier', 'mainPosition'],
      raw: true,
    }),
    models.externalRecord.findAll({
      where: { groupId, puuid: [puuidA, puuidB] },
      raw: true,
    }),
  ]);
  const summonerMap = {};
  for (const s of summoners) summonerMap[s.puuid] = s;
  const resolveName = (puuid) => (summonerMap[puuid] && summonerMap[puuid].name) || 'Unknown';

  const buildHeader = (user) => {
    // getInfo와 동일하게 외부 기록 승패 합산
    let wins = user.win || 0;
    let losses = user.lose || 0;
    for (const record of externalRecords) {
      if (record.puuid !== user.puuid) continue;
      wins += record.win || 0;
      losses += record.lose || 0;
    }
    const games = wins + losses;
    const summoner = summonerMap[user.puuid] || {};
    return {
      puuid: user.puuid,
      name: summoner.name || 'Unknown',
      rating: Math.round(user.defaultRating + user.additionalRating),
      rankTier: summoner.rankTier || null,
      mainPosition: summoner.mainPosition || null,
      wins,
      losses,
      winRate: games > 0 ? Math.round((wins / games) * 100) : null,
    };
  };

  // 맞대결 현재 연승: 시간순 마지막 승자가 몇 연승 중인지
  let streakHolder = null;
  let streakCount = 0;
  if (vsResults.length > 0) {
    const lastWon = vsResults[vsResults.length - 1].aWon;
    streakHolder = lastWon ? 'A' : 'B';
    for (let i = vsResults.length - 1; i >= 0 && vsResults[i].aWon === lastWon; i--) {
      streakCount++;
    }
  }

  const togetherWinRate = together.games > 0 ? (together.wins / together.games) * 100 : null;
  const aOverallWinRate = overall.a.games > 0 ? (overall.a.wins / overall.a.games) * 100 : null;
  const bOverallWinRate = overall.b.games > 0 ? (overall.b.wins / overall.b.games) * 100 : null;
  const expectedWinRate =
    aOverallWinRate !== null && bOverallWinRate !== null ? (aOverallWinRate + bOverallWinRate) / 2 : null;
  const synergyDelta =
    togetherWinRate !== null && expectedWinRate !== null ? Math.round(togetherWinRate - expectedWinRate) : null;

  const toMutualItem = ({ puuid, withA, withB, avgWinRate }) => ({
    puuid,
    name: resolveName(puuid),
    withA,
    withB,
    avgWinRate: Math.round(avgWinRate),
  });

  // 관계 타이틀 (표시 승률 기준, 복수 획득 가능)
  const aVsWinRate = vs.games > 0 ? Math.round((vs.aWins / vs.games) * 100) : null;
  const togetherWinRateRounded = togetherWinRate !== null ? Math.round(togetherWinRate) : null;
  const relationTitles = [];
  if (vs.games >= NATURAL_ENEMY_MIN_GAMES) {
    if (aVsWinRate >= NATURAL_ENEMY_WIN_RATE) {
      relationTitles.push({ key: 'natural_enemy', label: '천적', holder: 'A' });
    } else if (aVsWinRate <= 100 - NATURAL_ENEMY_WIN_RATE) {
      relationTitles.push({ key: 'natural_enemy', label: '천적', holder: 'B' });
    }
  }
  if (vs.games >= RIVAL_MIN_GAMES && aVsWinRate >= RIVAL_WIN_RATE_MIN && aVsWinRate <= RIVAL_WIN_RATE_MAX) {
    relationTitles.push({ key: 'fated_rivals', label: '숙명의 라이벌' });
  }
  if (together.games >= DUO_MIN_GAMES && togetherWinRateRounded >= DUO_WIN_RATE) {
    relationTitles.push({ key: 'fantastic_duo', label: '환상의 듀오' });
  }
  if (vs.games >= LOVE_HATE_MIN_GAMES && together.games >= LOVE_HATE_MIN_GAMES) {
    relationTitles.push({ key: 'love_hate', label: '애증의 관계' });
  }

  // 맞라인 전적 (포지션 데이터가 있는 경기만)
  const laneByPosition = POSITION_KEYS.filter((pos) => laneAcc[pos]).map((pos) => ({
    position: pos,
    ...laneAcc[pos],
  }));
  const laneMatchup = {
    games: laneByPosition.reduce((sum, l) => sum + l.games, 0),
    aWins: laneByPosition.reduce((sum, l) => sum + l.aWins, 0),
    bWins: laneByPosition.reduce((sum, l) => sum + l.bWins, 0),
    byPosition: laneByPosition,
  };

  return {
    status: 200,
    result: {
      header: { a: buildHeader(userA), b: buildHeader(userB) },
      headToHead: {
        games: vs.games,
        aWins: vs.aWins,
        bWins: vs.bWins,
        aWinRate: aVsWinRate,
        recentResults: vsResults.slice(-RECENT_VS_COUNT).map((r) => (r.aWon ? 'A' : 'B')),
        currentStreak: { holder: streakHolder, count: streakCount },
      },
      together: {
        games: together.games,
        wins: together.wins,
        losses: together.games - together.wins,
        winRate: togetherWinRateRounded,
        expectedWinRate: expectedWinRate !== null ? Math.round(expectedWinRate) : null,
        synergyDelta,
      },
      ratingFlow: {
        takenByA: Math.round(takenByA),
        takenByB: Math.round(takenByB),
        net: Math.round(takenByA - takenByB),
        computedGames: ratingComputedGames,
        skippedGames: ratingSkippedGames,
      },
      timeline: {
        firstVs,
        firstTogether,
        lastMetAt,
        vsGames: vs.games,
        togetherGames: together.games,
        totalGames: entangled.length,
        monthlyCounts: [...monthly.entries()].map(([month, games]) => ({ month, games })),
      },
      mutualSynergy: {
        minGames: MIN_GAMES_FOR_MUTUAL,
        goodWithBoth: goodWithBoth.map(toMutualItem),
        badWithBoth: badWithBoth.map(toMutualItem),
      },
      laneMatchup,
      relationTitles,
      ratingTrajectory: {
        a: toDailyRatingHistory(aRatingHistory),
        b: toDailyRatingHistory(bRatingHistory),
      },
      matches: {
        total: entangled.length,
        items: entangled.slice(-MATCH_LIST_COUNT).reverse(),
      },
    },
  };
};

module.exports.MIN_GAMES_FOR_MUTUAL = MIN_GAMES_FOR_MUTUAL;
