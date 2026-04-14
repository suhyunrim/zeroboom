const models = require('../db/models');
const { Op } = require('sequelize');
const { getTierName, getTierStep } = require('../utils/tierUtils');

/**
 * 내전 티어를 수치 단계로 변환 (비교용)
 * Iron IV=1, Iron III=2, ..., Challenger=40+
 */
const ratingToTierLevel = (rating) => {
  const tierOrder = {
    IRON: 0, BRONZE: 4, SILVER: 8, GOLD: 12,
    PLATINUM: 16, EMERALD: 20, DIAMOND: 24,
    MASTER: 28, GRANDMASTER: 32, CHALLENGER: 36,
  };
  const tierName = getTierName(rating);
  if (!tierName) return 0;
  const base = tierOrder[tierName] || 0;
  if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tierName)) {
    return base + Math.floor((rating - { MASTER: 900, GRANDMASTER: 1000, CHALLENGER: 1150 }[tierName]) / 25);
  }
  const step = getTierStep(rating); // 4=IV, 3=III, 2=II, 1=I
  return base + (5 - step);
};


/**
 * 매치를 3판2선 세트로 그룹핑
 * 같은 멤버 구성끼리 모아서 시간순으로 최대 3경기씩 묶음
 * 조건: 같은 멤버, 24시간 이내
 */
const groupMatchesIntoSets = (matches) => {
  if (!matches.length) return [];

  const twentyFourHours = 24 * 60 * 60 * 1000;

  // 같은 멤버 구성끼리 그룹핑
  const compositionGroups = {};
  matches.forEach(m => {
    const key = getCompositionKey(m);
    if (!compositionGroups[key]) compositionGroups[key] = [];
    compositionGroups[key].push(m);
  });

  const sets = [];

  Object.values(compositionGroups).forEach(group => {
    // 시간순 정렬
    group.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    let currentSet = [group[0]];

    for (let i = 1; i < group.length; i++) {
      const prev = currentSet[currentSet.length - 1];
      const curr = group[i];
      const timeDiff = new Date(curr.createdAt) - new Date(prev.createdAt);

      if (timeDiff <= twentyFourHours && currentSet.length < 3) {
        currentSet.push(curr);
      } else {
        sets.push(currentSet);
        currentSet = [curr];
      }
    }
    sets.push(currentSet);
  });

  return sets;
};

const getCompositionKey = (match) => {
  const t1 = match.team1.map(p => p[0]).sort();
  const t2 = match.team2.map(p => p[0]).sort();
  return [...t1, ...t2].join(',');
};

/**
 * 팀의 레이팅 합 계산 (team 배열의 3번째 요소가 rating)
 */
const getTeamRatingSum = (team) => {
  return team.reduce((sum, player) => sum + (player[2] || 0), 0);
};

/**
 * 팀의 레이팅 배열 반환
 */
const getTeamRatings = (team) => {
  return team.map(player => player[2] || 0);
};

/**
 * 매칭 밸런스 리포트 생성
 */
const generateReport = async (groupId, startDate, endDate) => {
  const where = { groupId, winTeam: { [Op.ne]: null } };
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt[Op.gte] = new Date(startDate);
    if (endDate) where.createdAt[Op.lte] = new Date(endDate);
  }

  const matches = await models.match.findAll({
    where,
    order: [['createdAt', 'ASC']],
    raw: true,
  });

  // raw 쿼리에서는 getter가 동작하지 않으므로 JSON 파싱
  const parsedMatches = matches.map(m => ({
    ...m,
    team1: typeof m.team1 === 'string' ? JSON.parse(m.team1) : m.team1,
    team2: typeof m.team2 === 'string' ? JSON.parse(m.team2) : m.team2,
  }));

  // 레이팅 없는 매치 제외
  const validMatches = parsedMatches.filter(m =>
    m.team1[0] && m.team1[0][2] !== undefined &&
    m.team2[0] && m.team2[0][2] !== undefined
  );

  // 포지션 분석을 위해 소환사 정보 조회
  const allPuuids = new Set();
  validMatches.forEach(m => {
    m.team1.forEach(p => allPuuids.add(p[0]));
    m.team2.forEach(p => allPuuids.add(p[0]));
  });

  const summoners = await models.summoner.findAll({
    where: { puuid: { [Op.in]: [...allPuuids] } },
    attributes: ['puuid', 'mainPosition', 'mainPositionRate', 'subPosition', 'subPositionRate'],
    raw: true,
  });

  const summonerMap = {};
  summoners.forEach(s => { summonerMap[s.puuid] = s; });

  // 세트 그룹핑
  const sets = groupMatchesIntoSets(validMatches);

  // 독립 매치: 세트 첫 판 + 단독 매치 (레이팅 편향 제거)
  const independentMatches = sets.map(s => s[0]);

  const summary = analyzeSummary(independentMatches);
  const ratingBrackets = analyzeRatingBrackets(independentMatches);
  const tierSpread = analyzeTierSpread(independentMatches);
  const positionAnalysis = analyzePositions(independentMatches, summonerMap);
  const setAnalysis = analyzeSetResults(validMatches, sets, summonerMap);
  const monthlyTrend = analyzeMonthlyTrend(independentMatches);

  return {
    totalMatches: validMatches.length,
    independentMatches: independentMatches.length,
    period: {
      start: validMatches.length ? validMatches[0].createdAt : null,
      end: validMatches.length ? validMatches[validMatches.length - 1].createdAt : null,
    },
    summary,
    ratingBrackets,
    tierSpread,
    positionAnalysis,
    setAnalysis,
    monthlyTrend,
  };
};

/**
 * 전체 요약
 */
const analyzeSummary = (matches) => {
  let favoredWins = 0;
  let totalRatingDiff = 0;

  matches.forEach(m => {
    const team1Sum = getTeamRatingSum(m.team1);
    const team2Sum = getTeamRatingSum(m.team2);
    const diff = Math.abs(team1Sum - team2Sum);
    totalRatingDiff += diff;

    const favoredTeam = team1Sum >= team2Sum ? 1 : 2;
    if (m.winTeam === favoredTeam) favoredWins++;
  });

  const avgDiff = matches.length ? totalRatingDiff / matches.length : 0;
  return {
    favoredTeamWinRate: matches.length ? Math.round((favoredWins / matches.length) * 1000) / 10 : 0,
    avgRatingDiff: Math.round(avgDiff * 10) / 10,
    avgPerPlayerDiff: Math.round(avgDiff / 5 * 10) / 10,
    expectedWinRate: Math.round(getExpectedWinRate(avgDiff) * 1000) / 10,
  };
};

/**
 * ELO 예상 승률 계산
 */
const getExpectedWinRate = (teamRatingDiff) => {
  return 1 / (1 + Math.pow(10, -teamRatingDiff / 400));
};

/**
 * 팀 레이팅 차이 구간별 승률
 * 팀 합산 차이를 인당 평균으로 나누고 티어 단계로 표현
 * 인당 25점 = 1단계
 */
const analyzeRatingBrackets = (matches) => {
  // 팀 합산 기준 구간 (인당 평균: /5)
  // 0~25: 인당 0~5 (거의 동일)
  // 26~50: 인당 5~10 (반 단계 차이)
  // 51~100: 인당 10~20 (1단계 이내)
  // 101+: 인당 20+ (1단계 이상)
  const brackets = [
    { label: '거의 동일', min: 0, max: 25, count: 0, favoredWins: 0, totalDiff: 0 },
    { label: '반 단계 차이', min: 26, max: 50, count: 0, favoredWins: 0, totalDiff: 0 },
    { label: '1단계 이내', min: 51, max: 100, count: 0, favoredWins: 0, totalDiff: 0 },
    { label: '1단계 이상', min: 101, max: Infinity, count: 0, favoredWins: 0, totalDiff: 0 },
  ];

  matches.forEach(m => {
    const team1Sum = getTeamRatingSum(m.team1);
    const team2Sum = getTeamRatingSum(m.team2);
    const diff = Math.abs(team1Sum - team2Sum);
    const favoredTeam = team1Sum >= team2Sum ? 1 : 2;

    const bracket = brackets.find(b => diff >= b.min && diff <= b.max);
    if (bracket) {
      bracket.count++;
      bracket.totalDiff += diff;
      if (m.winTeam === favoredTeam) bracket.favoredWins++;
    }
  });

  return brackets.map(b => {
    const avgDiff = b.count ? b.totalDiff / b.count : 0;
    const expectedWinRate = Math.round(getExpectedWinRate(avgDiff) * 1000) / 10;
    return {
      label: b.label,
      count: b.count,
      favoredWinRate: b.count ? Math.round((b.favoredWins / b.count) * 1000) / 10 : 0,
      expectedWinRate,
    };
  });
};

/**
 * 팀 내 티어 편차 분석 (내전 티어 기준)
 */
const analyzeTierSpread = (matches) => {
  const brackets = [
    { label: '0~8단계 (2티어 이내)', min: 0, max: 8, count: 0, favoredWins: 0 },
    { label: '9~16단계 (3~4티어)', min: 9, max: 16, count: 0, favoredWins: 0 },
    { label: '17~24단계 (5~6티어)', min: 17, max: 24, count: 0, favoredWins: 0 },
    { label: '25단계+ (7티어 이상)', min: 25, max: Infinity, count: 0, favoredWins: 0 },
  ];

  matches.forEach(m => {
    const team1Sum = getTeamRatingSum(m.team1);
    const team2Sum = getTeamRatingSum(m.team2);
    const favoredTeam = team1Sum >= team2Sum ? 1 : 2;

    // 양 팀의 티어 레벨 편차 중 큰 쪽 사용
    const getSpread = (team) => {
      const levels = getTeamRatings(team).map(r => ratingToTierLevel(r));
      return Math.max(...levels) - Math.min(...levels);
    };

    const maxSpread = Math.max(getSpread(m.team1), getSpread(m.team2));
    const bracket = brackets.find(b => maxSpread >= b.min && maxSpread <= b.max);
    if (bracket) {
      bracket.count++;
      if (m.winTeam === favoredTeam) bracket.favoredWins++;
    }
  });

  return brackets.map(b => ({
    label: b.label,
    count: b.count,
    favoredWinRate: b.count ? Math.round((b.favoredWins / b.count) * 1000) / 10 : 0,
  }));
};

/**
 * 포지션 분석 (rate 기반 적합도 점수)
 *
 * 팀 포지션 적합도 점수:
 * - 5개 포지션에 대해 각 유저가 해당 포지션을 얼마나 잘하는지 rate로 계산
 * - 각 포지션에서 가장 높은 rate를 가진 유저의 rate를 합산
 * - 최대 500점 (5포지션 x 100%), 높을수록 포지션 분포가 좋음
 */
const analyzePositions = (matches, summonerMap) => {
  const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

  // 유저의 포지션별 rate 반환
  const getPlayerPositionRates = (puuid) => {
    const s = summonerMap[puuid];
    if (!s) return {};
    const rates = {};
    if (s.mainPosition && s.mainPositionRate) {
      rates[s.mainPosition] = s.mainPositionRate;
    }
    if (s.subPosition && s.subPositionRate >= 10) {
      rates[s.subPosition] = s.subPositionRate;
    }
    return rates;
  };

  // 팀 포지션 적합도 점수 (0~500)
  // 각 포지션별로 팀원 중 가장 높은 rate를 합산
  const getTeamPositionScore = (team) => {
    let score = 0;
    POSITIONS.forEach(pos => {
      let maxRate = 0;
      team.forEach(player => {
        const rates = getPlayerPositionRates(player[0]);
        if (rates[pos] && rates[pos] > maxRate) maxRate = rates[pos];
      });
      score += maxRate;
    });
    return Math.round(score * 10) / 10;
  };

  // 팀 포지션 커버리지 (몇 개 포지션을 커버하는지)
  const getTeamPositionCoverage = (team) => {
    const covered = new Set();
    team.forEach(player => {
      const rates = getPlayerPositionRates(player[0]);
      Object.keys(rates).forEach(pos => covered.add(pos));
    });
    return covered.size;
  };

  // mainPosition 기준 겹침 수
  const getTeamMainOverlapCount = (team) => {
    const posCount = {};
    team.forEach(player => {
      const s = summonerMap[player[0]];
      if (s && s.mainPosition) {
        posCount[s.mainPosition] = (posCount[s.mainPosition] || 0) + 1;
      }
    });
    return Object.values(posCount).filter(c => c >= 2).length;
  };

  // 매치별 분석
  const scoreData = [];
  const scoreBrackets = [
    { label: '좋음', min: 300, max: Infinity, count: 0, favoredWins: 0 },
    { label: '보통', min: 200, max: 299, count: 0, favoredWins: 0 },
    { label: '나쁨', min: 0, max: 199, count: 0, favoredWins: 0 },
  ];

  const positionOverlapCount = {};
  let totalScore = 0;
  let totalScoreDiff = 0;
  let totalCoverage = 0;
  let teamCount = 0;

  matches.forEach(m => {
    const team1Sum = getTeamRatingSum(m.team1);
    const team2Sum = getTeamRatingSum(m.team2);
    const favoredTeam = team1Sum >= team2Sum ? 1 : 2;

    const score1 = getTeamPositionScore(m.team1);
    const score2 = getTeamPositionScore(m.team2);
    const avgScore = (score1 + score2) / 2;

    totalScore += score1 + score2;
    totalScoreDiff += Math.abs(score1 - score2);
    totalCoverage += getTeamPositionCoverage(m.team1) + getTeamPositionCoverage(m.team2);
    teamCount += 2;

    const bracket = scoreBrackets.find(b => avgScore >= b.min && avgScore <= b.max);
    if (bracket) {
      bracket.count++;
      if (m.winTeam === favoredTeam) bracket.favoredWins++;
    }

    // 겹침 포지션 집계
    [m.team1, m.team2].forEach(team => {
      const posCount = {};
      team.forEach(player => {
        const s = summonerMap[player[0]];
        if (s && s.mainPosition) {
          posCount[s.mainPosition] = (posCount[s.mainPosition] || 0) + 1;
        }
      });
      Object.entries(posCount).forEach(([pos, count]) => {
        if (count >= 2) {
          positionOverlapCount[pos] = (positionOverlapCount[pos] || 0) + 1;
        }
      });
    });
  });

  const totalOverlaps = Object.values(positionOverlapCount).reduce((a, b) => a + b, 0);
  const mostOverlappedPositions = Object.entries(positionOverlapCount)
    .sort((a, b) => b[1] - a[1])
    .map(([pos, count]) => ({
      position: pos,
      count,
      rate: totalOverlaps ? Math.round((count / totalOverlaps) * 1000) / 10 : 0,
    }));

  const avgDiff = matches.length ? totalScoreDiff / matches.length : 0;
  const getBalanceLabel = (diff) => {
    if (diff <= 20) return '좋음';
    if (diff <= 50) return '보통';
    if (diff <= 80) return '나쁨';
    return '매우 나쁨';
  };

  return {
    avgPositionScore: teamCount ? Math.round(totalScore / teamCount * 10) / 10 : 0,
    avgPositionScoreDiff: Math.round(avgDiff * 10) / 10,
    avgPositionBalance: getBalanceLabel(avgDiff),
    avgPositionCoverage: teamCount ? Math.round((totalCoverage / teamCount) * 10) / 10 : 0,
    scoreBrackets: scoreBrackets.map(b => ({
      label: b.label,
      count: b.count,
      favoredWinRate: b.count ? Math.round((b.favoredWins / b.count) * 1000) / 10 : 0,
    })),
    mostOverlappedPositions,
  };
};

/**
 * 세트 결과 분석 (2:0 / 2:1 비율)
 */
const analyzeSetResults = (matches, sets, summonerMap) => {
  const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

  const getPlayerPositionRates = (puuid) => {
    const s = summonerMap[puuid];
    if (!s) return {};
    const rates = {};
    if (s.mainPosition && s.mainPositionRate) rates[s.mainPosition] = s.mainPositionRate;
    if (s.subPosition && s.subPositionRate >= 10) rates[s.subPosition] = s.subPositionRate;
    return rates;
  };

  const getTeamPositionScore = (team) => {
    let score = 0;
    POSITIONS.forEach(pos => {
      let maxRate = 0;
      team.forEach(p => {
        const rates = getPlayerPositionRates(p[0]);
        if (rates[pos] && rates[pos] > maxRate) maxRate = rates[pos];
      });
      score += maxRate;
    });
    return Math.round(score * 10) / 10;
  };

  // 2~3경기 세트만 분석 (1경기 단독은 세트가 아님)
  const validSets = sets.filter(s => s.length >= 2);

  let twoZero = 0;
  let twoOne = 0;
  let incomplete = 0;
  let favoredTwoZeroWin = 0;
  let favoredTwoOneWin = 0;
  let underdogTwoZeroWin = 0;
  let underdogTwoOneWin = 0;

  // 포지션 점수 차이 vs 2:0 비율
  const posScoreBrackets = [
    { label: '좋음', min: 0, max: 20, twoZero: 0, twoOne: 0 },
    { label: '보통', min: 21, max: 50, twoZero: 0, twoOne: 0 },
    { label: '나쁨', min: 51, max: 80, twoZero: 0, twoOne: 0 },
    { label: '매우 나쁨', min: 81, max: Infinity, twoZero: 0, twoOne: 0 },
  ];

  validSets.forEach(set => {
    const firstMatch = set[0];
    const team1Sum = getTeamRatingSum(firstMatch.team1);
    const team2Sum = getTeamRatingSum(firstMatch.team2);
    const favoredTeam = team1Sum >= team2Sum ? 1 : 2;

    const wins = { 1: 0, 2: 0 };
    set.forEach(m => { wins[m.winTeam]++; });

    const setWinner = wins[1] >= 2 ? 1 : wins[2] >= 2 ? 2 : null;
    if (!setWinner) {
      incomplete++;
      return;
    }

    const isFavoredWin = setWinner === favoredTeam;
    const isTwoZero = set.length === 2;

    if (isTwoZero) {
      twoZero++;
      if (isFavoredWin) favoredTwoZeroWin++;
      else underdogTwoZeroWin++;
    } else {
      twoOne++;
      if (isFavoredWin) favoredTwoOneWin++;
      else underdogTwoOneWin++;
    }

    // 포지션 점수 차이 구간 집계
    const score1 = getTeamPositionScore(firstMatch.team1);
    const score2 = getTeamPositionScore(firstMatch.team2);
    const scoreDiff = Math.abs(score1 - score2);
    const bracket = posScoreBrackets.find(b => scoreDiff >= b.min && scoreDiff <= b.max);
    if (bracket) {
      if (isTwoZero) bracket.twoZero++;
      else bracket.twoOne++;
    }
  });

  const totalSets = twoZero + twoOne;

  return {
    totalSets,
    singleMatches: sets.filter(s => s.length === 1).length,
    incomplete,
    twoZero: {
      count: twoZero,
      rate: totalSets ? Math.round((twoZero / totalSets) * 1000) / 10 : 0,
      favoredWin: favoredTwoZeroWin,
      underdogWin: underdogTwoZeroWin,
    },
    twoOne: {
      count: twoOne,
      rate: totalSets ? Math.round((twoOne / totalSets) * 1000) / 10 : 0,
      favoredWin: favoredTwoOneWin,
      underdogWin: underdogTwoOneWin,
    },
    positionScoreImpact: posScoreBrackets.map(b => {
      const total = b.twoZero + b.twoOne;
      return {
        label: b.label,
        totalSets: total,
        twoZeroCount: b.twoZero,
        twoZeroRate: total ? Math.round((b.twoZero / total) * 1000) / 10 : 0,
      };
    }),
  };
};

/**
 * 월별 추이 분석
 */
const analyzeMonthlyTrend = (matches) => {
  const monthlyData = {};

  matches.forEach(m => {
    const date = new Date(m.createdAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    if (!monthlyData[key]) {
      monthlyData[key] = { count: 0, favoredWins: 0, totalDiff: 0 };
    }

    const team1Sum = getTeamRatingSum(m.team1);
    const team2Sum = getTeamRatingSum(m.team2);
    const favoredTeam = team1Sum >= team2Sum ? 1 : 2;

    monthlyData[key].count++;
    monthlyData[key].totalDiff += Math.abs(team1Sum - team2Sum);
    if (m.winTeam === favoredTeam) monthlyData[key].favoredWins++;
  });

  return Object.entries(monthlyData)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      matchCount: data.count,
      favoredWinRate: Math.round((data.favoredWins / data.count) * 1000) / 10,
      avgRatingDiff: Math.round(data.totalDiff / data.count * 10) / 10,
    }));
};

module.exports = { generateReport };
