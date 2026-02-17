/**
 * 포지션 최적화 모듈
 * 레이팅 기반 매칭 결과에서 포지션 배정을 최적화
 */

const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'SUPPORT'];

const POSITION_KR = {
  TOP: '탑',
  JUNGLE: '정글',
  MIDDLE: '미드',
  BOTTOM: '원딜',
  SUPPORT: '서폿',
};

const POSITION_EN = {
  '탑': 'TOP',
  '정글': 'JUNGLE',
  '미드': 'MIDDLE',
  '원딜': 'BOTTOM',
  '서폿': 'SUPPORT',
  '상관X': null,
};

/**
 * 5명 팀의 모든 포지션 순열 생성 (5! = 120)
 */
const generatePermutations = (arr) => {
  if (arr.length <= 1) return [arr];

  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    const remaining = [...arr.slice(0, i), ...arr.slice(i + 1)];
    const permutations = generatePermutations(remaining);

    for (const perm of permutations) {
      result.push([current, ...perm]);
    }
  }
  return result;
};

/**
 * 플레이어의 포지션 배정 점수 계산
 * - 메인 포지션: mainPositionRate * 100
 * - 서브 포지션: subPositionRate * 50
 * - 오프 포지션: 0
 * @param {Object} player - { mainPos, subPos, mainPositionRate, subPositionRate }
 * @param {string} position - 배정할 포지션
 * @returns {number} 점수 (높을수록 좋음)
 */
const getPositionScore = (player, position) => {
  if (player.mainPos === position) {
    return (player.mainPositionRate || 0.5) * 100;
  }
  if (player.subPos === position) {
    return (player.subPositionRate || 0.3) * 50;
  }
  return 0;
};

/**
 * 배정 타입 결정
 */
const getAssignmentType = (player, position) => {
  if (player.mainPos === position) return 'MAIN';
  if (player.subPos === position) return 'SUB';
  return 'OFF';
};

/**
 * 팀 내 최적 포지션 배정
 * 80% 이상 유저 우선 배정 → 나머지 메인 → 서브 → 오프
 * @param {Array} players - 5명의 플레이어 배열
 * @returns {Object} { assignments, totalScore, offCount, subCount, mainCount }
 */
const assignPositionsForTeam = (players) => {
  if (players.length !== 5) return null;

  const availablePositions = new Set(POSITIONS);
  const assignments = [];
  let totalScore = 0;
  let offCount = 0;
  let subCount = 0;
  let mainCount = 0;

  // 80% 이상 유저와 그 외 분리
  const highRatePlayers = players.filter(p => (p.mainPositionRate || 0) >= 80);
  const normalPlayers = players.filter(p => (p.mainPositionRate || 0) < 80);

  // 80% 이상 유저는 mainPositionRate 높은 순 정렬
  highRatePlayers.sort((a, b) => (b.mainPositionRate || 0) - (a.mainPositionRate || 0));

  // 나머지 유저도 mainPositionRate 높은 순 정렬
  normalPlayers.sort((a, b) => (b.mainPositionRate || 0) - (a.mainPositionRate || 0));

  // 1차: 80% 이상 유저 메인 포지션 우선 배정
  const unassignedHighRate = [];
  for (const player of highRatePlayers) {
    if (player.mainPos && availablePositions.has(player.mainPos)) {
      availablePositions.delete(player.mainPos);
      const score = getPositionScore(player, player.mainPos);
      assignments.push({
        playerId: player.id,
        playerName: player.name,
        position: player.mainPos,
        assignmentType: 'MAIN',
        score,
      });
      totalScore += score;
      mainCount++;
    } else {
      unassignedHighRate.push(player);
    }
  }

  // 2차: 일반 유저 메인 포지션 배정
  const unassignedNormal = [];
  for (const player of normalPlayers) {
    if (player.mainPos && availablePositions.has(player.mainPos)) {
      availablePositions.delete(player.mainPos);
      const score = getPositionScore(player, player.mainPos);
      assignments.push({
        playerId: player.id,
        playerName: player.name,
        position: player.mainPos,
        assignmentType: 'MAIN',
        score,
      });
      totalScore += score;
      mainCount++;
    } else {
      unassignedNormal.push(player);
    }
  }

  // 3차: 80% 이상인데 메인 못 받은 유저 서브 배정
  const stillUnassignedHighRate = [];
  for (const player of unassignedHighRate) {
    if (player.subPos && availablePositions.has(player.subPos)) {
      availablePositions.delete(player.subPos);
      const score = getPositionScore(player, player.subPos);
      assignments.push({
        playerId: player.id,
        playerName: player.name,
        position: player.subPos,
        assignmentType: 'SUB',
        score,
      });
      totalScore += score;
      subCount++;
    } else {
      stillUnassignedHighRate.push(player);
    }
  }

  // 4차: 일반 유저 서브 포지션 배정
  const stillUnassignedNormal = [];
  for (const player of unassignedNormal) {
    if (player.subPos && availablePositions.has(player.subPos)) {
      availablePositions.delete(player.subPos);
      const score = getPositionScore(player, player.subPos);
      assignments.push({
        playerId: player.id,
        playerName: player.name,
        position: player.subPos,
        assignmentType: 'SUB',
        score,
      });
      totalScore += score;
      subCount++;
    } else {
      stillUnassignedNormal.push(player);
    }
  }

  // 5차: 남은 포지션에 오프로 배정
  const allUnassigned = [...stillUnassignedHighRate, ...stillUnassignedNormal];
  const remainingPositions = Array.from(availablePositions);
  for (let i = 0; i < allUnassigned.length; i++) {
    const player = allUnassigned[i];
    const position = remainingPositions[i];
    assignments.push({
      playerId: player.id,
      playerName: player.name,
      position,
      assignmentType: 'OFF',
      score: 0,
    });
    offCount++;
  }

  // 포지션 순서대로 정렬
  assignments.sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));

  return {
    players: players.map(p => p.id),
    playerNames: players.map(p => p.name),
    assignments,
    totalScore,
    offCount,
    subCount,
    mainCount,
  };
};

/**
 * 이미 나눠진 팀에 대해 포지션 배정
 * @param {Array} teamAPlayers - 팀A 5명
 * @param {Array} teamBPlayers - 팀B 5명
 * @returns {Object} { teamA, teamB, totalScore, scoreDiff }
 */
const assignPositionsForFixedTeams = (teamAPlayers, teamBPlayers) => {
  const teamA = assignPositionsForTeam(teamAPlayers);
  const teamB = assignPositionsForTeam(teamBPlayers);

  if (!teamA || !teamB) return null;

  const totalScore = teamA.totalScore + teamB.totalScore;
  const scoreDiff = Math.abs(teamA.totalScore - teamB.totalScore);

  return {
    teamA,
    teamB,
    totalScore,
    scoreDiff,
    totalOffCount: teamA.offCount + teamB.offCount,
    totalSubCount: teamA.subCount + teamB.subCount,
    totalMainCount: teamA.mainCount + teamB.mainCount,
  };
};

/**
 * 80% 이상 유저가 같은 포지션에 여러 명일 때 팀 분배 검증
 * @param {Array} team1Names - 팀1 이름 배열
 * @param {Array} team2Names - 팀2 이름 배열
 * @param {Object} playerDataMap - 유저 데이터 맵
 * @returns {boolean} 유효한 분배인지
 */
const validateHighRateDistribution = (team1Names, team2Names, playerDataMap) => {
  // 포지션별 80% 이상 유저 수집
  const positionHighRatePlayers = {};
  POSITIONS.forEach(pos => {
    positionHighRatePlayers[pos] = [];
  });

  Object.values(playerDataMap).forEach(p => {
    if ((p.mainPositionRate || 0) >= 80 && p.mainPos && positionHighRatePlayers[p.mainPos]) {
      positionHighRatePlayers[p.mainPos].push(p);
    }
  });

  // 같은 포지션에 80% 이상이 2명 이상이면, 각 팀에 최소 1명씩 있어야 함
  for (const pos of POSITIONS) {
    const highRatePlayers = positionHighRatePlayers[pos];
    if (highRatePlayers.length >= 2) {
      // 상위 2명 (레이팅 순)
      highRatePlayers.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      const top2 = highRatePlayers.slice(0, 2);

      const team1Has = top2.some(p => team1Names.includes(p.name));
      const team2Has = top2.some(p => team2Names.includes(p.name));

      // 둘 다 같은 팀에 있으면 유효하지 않음
      if (top2.length === 2) {
        const bothInTeam1 = top2.every(p => team1Names.includes(p.name));
        const bothInTeam2 = top2.every(p => team2Names.includes(p.name));
        if (bothInTeam1 || bothInTeam2) {
          return false;
        }
      }
    }
  }

  return true;
};

/**
 * 레이팅 기반 매칭 결과에서 포지션 최적화
 * @param {Array} matches - 기존 매칭 결과 배열 [{team1, team2, team1WinRate, ...}]
 * @param {Object} playerDataMap - puuid -> { mainPos, subPos, mainPositionRate, subPositionRate, rating, name }
 * @param {Object} options - { topN: 20, resultCount: 3 }
 * @returns {Array} 포지션 최적화된 상위 결과
 */
const optimizePositionsForMatches = (matches, playerDataMap, options = {}) => {
  const { topN = 20, resultCount = 3 } = options;

  // 상위 N개 매칭만 선택
  let topMatches = matches.slice(0, topN);

  // 80% 이상 유저 분배 검증 필터링
  const validMatches = topMatches.filter(match => {
    const team1Names = match.team1Names || match.team1;
    const team2Names = match.team2Names || match.team2;
    return validateHighRateDistribution(team1Names, team2Names, playerDataMap);
  });

  // 유효한 매칭이 있으면 사용, 없으면 원본 사용
  topMatches = validMatches.length > 0 ? validMatches : topMatches;

  const results = [];

  for (const match of topMatches) {
    // team1Names, team2Names에서 플레이어 정보 가져오기
    const team1Names = match.team1Names || match.team1;
    const team2Names = match.team2Names || match.team2;

    const teamAPlayers = team1Names.map(name => {
      const data = playerDataMap[name] || {};
      return {
        id: data.puuid || name,
        name: name,
        rating: data.rating || 500,
        mainPos: data.mainPos,
        subPos: data.subPos,
        mainPositionRate: data.mainPositionRate || 0,
        subPositionRate: data.subPositionRate || 0,
      };
    });

    const teamBPlayers = team2Names.map(name => {
      const data = playerDataMap[name] || {};
      return {
        id: data.puuid || name,
        name: name,
        rating: data.rating || 500,
        mainPos: data.mainPos,
        subPos: data.subPos,
        mainPositionRate: data.mainPositionRate || 0,
        subPositionRate: data.subPositionRate || 0,
      };
    });

    const positionResult = assignPositionsForFixedTeams(teamAPlayers, teamBPlayers);

    if (positionResult) {
      results.push({
        ...match,
        positionOptimization: positionResult,
      });
    }
  }

  // 정렬: 총 오프 수 → 팀별 오프 수 차이 → 점수 차 → 점수 합
  results.sort((a, b) => {
    const poA = a.positionOptimization;
    const poB = b.positionOptimization;

    // 1. 총 오프 수 (적을수록 좋음)
    if (poA.totalOffCount !== poB.totalOffCount) {
      return poA.totalOffCount - poB.totalOffCount;
    }

    // 2. 팀별 오프 수 차이 (적을수록 좋음)
    const offDiffA = Math.abs(poA.teamA.offCount - poA.teamB.offCount);
    const offDiffB = Math.abs(poB.teamA.offCount - poB.teamB.offCount);
    if (offDiffA !== offDiffB) {
      return offDiffA - offDiffB;
    }

    // 3. 점수 차 (적을수록 좋음)
    if (poA.scoreDiff !== poB.scoreDiff) {
      return poA.scoreDiff - poB.scoreDiff;
    }

    // 4. 점수 합 (높을수록 좋음)
    return poB.totalScore - poA.totalScore;
  });

  return results.slice(0, resultCount);
};

module.exports = {
  POSITIONS,
  POSITION_KR,
  POSITION_EN,
  getPositionScore,
  getAssignmentType,
  assignPositionsForTeam,
  assignPositionsForFixedTeams,
  optimizePositionsForMatches,
  generatePermutations,
};
