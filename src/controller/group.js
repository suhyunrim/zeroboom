const models = require('../db/models');
const { logger } = require('../loaders/logger');
const { Op } = require('sequelize');
const elo = require('arpad');

const RankingMinumumMatchCount = 5;

const ratingCalculator = new elo(16);

/**
 * 만료되지 않은 외부 기록을 puuid별로 합산
 * @param {number} groupId
 * @param {string} [puuid] - 특정 유저만 조회 시
 */
const getExternalStats = async (groupId, puuid) => {
  const where = { groupId, expiresAt: { [Op.gt]: new Date() } };
  if (puuid) where.puuid = puuid;

  const records = await models.externalRecord.findAll({ where });
  const stats = {};
  for (const record of records) {
    if (!stats[record.puuid]) stats[record.puuid] = { win: 0, lose: 0 };
    stats[record.puuid].win += record.win || 0;
    stats[record.puuid].lose += record.lose || 0;
  }
  return stats;
};

module.exports.get = async (id) => {
  const result = await models.group.findByPk(id);

  if (!(result instanceof models.group)) {
    throw new Error(`Cannot find group(id:${id})`);
  }

  return result;
};

module.exports.getByName = async (groupName) => {
  const result = await models.group.findOne({ where: { groupName } });

  if (!(result instanceof models.group)) {
    throw new Error(`Cannot find group(id:${id})`);
  }

  return result;
};

module.exports.getByDiscordGuildId = async (id) => {
  const result = await models.group.findOne({ where: { discordGuildId: id } });

  if (!(result instanceof models.group)) {
    throw new Error(`Cannot find group(id:${id})`);
  }

  return result;
};

module.exports.registerGroup = async (groupName) => {
  const result = await models.group.findOrCreate({ where: { groupName } });
  return { result: result[1] ? 'succeed' : 'already exist', status: 200 };
};

module.exports.setUserRole = async (groupName, accountId, role) => {
  if (!groupName) return { result: 'invalid groupId', status: 501 };
  if (!accountId) return { result: 'invalid accountId', status: 501 };
  if (role !== 'admin' && role !== 'member' && role !== 'outsider') return { result: 'invalid role type', status: 501 };

  const group = await models.group.findOne({ where: { groupName } });
  if (!group) return { result: 'group is not exist' };

  try {
    await models.user.update({ role }, { where: { groupId: group.id, accountId } });
    return { result: {}, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

module.exports.getRanking = async (groupName) => {
  const group = await models.group.findOne({ where: { groupName } });
  if (!group) return { result: 'group is not exist' };

  let users = await models.user.findAll({
    where: {
      groupId: group.id,
      role: { [Op.ne]: 'outsider' },
      leftGuildAt: null,
    },
  });

  const externalStats = await getExternalStats(group.id);

  // 외부 기록을 포함한 win/lose 계산
  const userStats = users.map((user) => {
    const ext = externalStats[user.puuid] || { win: 0, lose: 0 };
    return {
      ...user.dataValues,
      totalWin: user.win + ext.win,
      totalLose: user.lose + ext.lose,
    };
  });

  let filteredUsers = userStats.filter((elem) => elem.totalWin + elem.totalLose >= RankingMinumumMatchCount);

  filteredUsers.sort((a, b) => b.defaultRating + b.additionalRating - (a.defaultRating + a.additionalRating));

  const userIds = filteredUsers.map((elem) => elem.puuid);
  const summoners = await models.summoner.findAll({
    where: { puuid: userIds },
  });
  const summonerObj = summoners.reduce((obj, v) => {
    obj[v.puuid] = v;
    return obj;
  }, {});

  let result = filteredUsers.map((elem, index) => {
    return {
      puuid: elem.puuid,
      ranking: index + 1,
      rating: elem.defaultRating + elem.additionalRating,
      win: elem.totalWin,
      lose: elem.totalLose,
      winRate: Math.ceil((elem.totalWin / (elem.totalWin + elem.totalLose)) * 100),
    };
  });

  result.forEach((user) => {
    user.name = summonerObj[user.puuid].name;
  });

  return { result: result, status: 200 };
};

module.exports.getMyRanking = async (groupName, puuid, rankingResult) => {
  // 이미 랭킹에 포함되어 있는지 확인
  const found = rankingResult.find((r) => r.puuid === puuid);
  if (found) {
    return { ...found, reason: null };
  }

  // 랭킹에 없는 경우: 유저 정보 조회
  const group = await models.group.findOne({ where: { groupName } });
  if (!group) return null;

  const user = await models.user.findOne({
    where: { puuid, groupId: group.id },
  });
  if (!user) return null;

  const [summoner, externalStats] = await Promise.all([
    models.summoner.findOne({ where: { puuid } }),
    getExternalStats(group.id, puuid),
  ]);

  const ext = externalStats[puuid] || { win: 0, lose: 0 };
  const totalWin = user.win + ext.win;
  const totalLose = user.lose + ext.lose;
  const totalGames = totalWin + totalLose;

  // 미달 사유 판별
  let reason = null;
  if (user.role === 'outsider') {
    reason = '블랙리스트';
  } else if (totalGames < RankingMinumumMatchCount) {
    reason = `${RankingMinumumMatchCount}판 미만`;
  }

  return {
    puuid,
    ranking: null,
    name: summoner ? summoner.name : 'Unknown',
    rating: user.defaultRating + user.additionalRating,
    win: totalWin,
    lose: totalLose,
    winRate: totalGames > 0 ? Math.ceil((totalWin / totalGames) * 100) : 0,
    reason,
  };
};

module.exports.getMyRankingByPeriod = async (groupId, puuid, rankingResult) => {
  const idx = rankingResult.findIndex((r) => r.puuid === puuid);
  if (idx !== -1) {
    return { ...rankingResult[idx], ranking: idx + 1, reason: null };
  }

  // 기간 내 매치 참여 없음
  const summoner = await models.summoner.findOne({ where: { puuid } });
  return {
    puuid,
    ranking: null,
    name: summoner ? summoner.name : 'Unknown',
    win: 0,
    lose: 0,
    games: 0,
    winRate: 0,
    rating: null,
    ratingChange: 0,
    reason: '해당 기간 내 매치 없음',
  };
};

module.exports.getRankingByPeriod = async (groupId, startDate, endDate) => {
  const group = await models.group.findByPk(groupId);
  if (!group) return { result: 'group is not exist', status: 404 };

  // 기간 내 완료된 매치 조회
  const matches = await models.match.findAll({
    where: {
      groupId: group.id,
      winTeam: { [Op.ne]: null },
      createdAt: {
        [Op.gte]: startDate,
        [Op.lte]: endDate,
      },
    },
    order: [['createdAt', 'ASC']],
  });

  // 유저별 승/패/레이팅 증감 집계
  const userStats = {};

  for (const match of matches) {
    const team1Data = match.team1;
    const team2Data = match.team2;
    const hasSnapshot = team1Data[0] && team1Data[0].length >= 3;

    // 팀 평균 레이팅 계산
    let team1Avg, team2Avg;
    if (hasSnapshot) {
      team1Avg = team1Data.reduce((sum, p) => sum + p[2], 0) / team1Data.length;
      team2Avg = team2Data.reduce((sum, p) => sum + p[2], 0) / team2Data.length;
    } else {
      // 스냅샷 없는 매치는 레이팅 변동 계산 불가 — 승패만 집계
      team1Avg = null;
      team2Avg = null;
    }

    // 레이팅 변동 계산
    let team1Delta = 0;
    let team2Delta = 0;
    if (team1Avg !== null && team2Avg !== null) {
      if (match.winTeam === 1) {
        team1Delta = ratingCalculator.newRatingIfWon(team1Avg, team2Avg) - team1Avg;
        team2Delta = ratingCalculator.newRatingIfLost(team2Avg, team1Avg) - team2Avg;
      } else {
        team1Delta = ratingCalculator.newRatingIfLost(team1Avg, team2Avg) - team1Avg;
        team2Delta = ratingCalculator.newRatingIfWon(team2Avg, team1Avg) - team2Avg;
      }
    }

    // 팀1 유저 집계
    for (const player of team1Data) {
      const puuid = player[0];
      if (!userStats[puuid]) {
        userStats[puuid] = { puuid, win: 0, lose: 0, ratingChange: 0, lastRating: null };
      }
      if (match.winTeam === 1) userStats[puuid].win++;
      else userStats[puuid].lose++;
      userStats[puuid].ratingChange += team1Delta;
      if (hasSnapshot) {
        userStats[puuid].lastRating = Math.round(player[2] + team1Delta);
      }
    }

    // 팀2 유저 집계
    for (const player of team2Data) {
      const puuid = player[0];
      if (!userStats[puuid]) {
        userStats[puuid] = { puuid, win: 0, lose: 0, ratingChange: 0, lastRating: null };
      }
      if (match.winTeam === 2) userStats[puuid].win++;
      else userStats[puuid].lose++;
      userStats[puuid].ratingChange += team2Delta;
      if (hasSnapshot) {
        userStats[puuid].lastRating = Math.round(player[2] + team2Delta);
      }
    }
  }

  // outsider 제외
  const outsiders = await models.user.findAll({
    where: { groupId: group.id, role: 'outsider' },
    attributes: ['puuid'],
  });
  const outsiderSet = new Set(outsiders.map((u) => u.puuid));
  outsiderSet.forEach((puuid) => {
    delete userStats[puuid];
  });

  // 소환사 이름 조회
  const puuids = Object.keys(userStats);
  const summoners = await models.summoner.findAll({
    where: { puuid: puuids },
  });
  const summonerMap = {};
  for (const s of summoners) {
    summonerMap[s.puuid] = s.name;
  }

  // 결과 정리 및 기간 말 레이팅 기준 정렬 (프론트 표 기본 정렬과 일치)
  const ratingOrNeg = (r) => (r != null ? r : -Infinity);
  const result = Object.values(userStats)
    .map((stat) => ({
      puuid: stat.puuid,
      name: summonerMap[stat.puuid] || 'Unknown',
      win: stat.win,
      lose: stat.lose,
      games: stat.win + stat.lose,
      winRate: stat.win + stat.lose > 0
        ? Math.round((stat.win / (stat.win + stat.lose)) * 100)
        : 0,
      rating: stat.lastRating,
      ratingChange: Math.round(stat.ratingChange),
    }))
    .sort((a, b) => ratingOrNeg(b.rating) - ratingOrNeg(a.rating));

  return { result, status: 200 };
};

const RANKING_POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

/**
 * 포지션별 랭킹: 해당 포지션으로 뛴 판에서 발생한 레이팅 증감 누적(득실) 기준 정렬.
 * 매치 저장 포맷 [puuid, name, rating, position]의 레이팅 스냅샷과 포지션을 사용하며,
 * 포지션이 기록된 플레이어만 집계한다.
 */
module.exports.getPositionRanking = async (groupId, myPuuid) => {
  const group = await models.group.findByPk(groupId);
  if (!group) return { result: 'group is not exist', status: 404 };

  const matches = await models.match.findAll({
    where: { groupId: group.id, winTeam: { [Op.ne]: null } },
    order: [['createdAt', 'ASC']],
  });

  // puuid -> position -> { win, lose, ratingChange }
  const stats = {};

  for (const match of matches) {
    const team1Data = match.team1;
    const team2Data = match.team2;
    // 10명 전원 포지션이 기록된 매치만 집계 (포지션이 있으면 레이팅 스냅샷도 항상 있다)
    const allPositioned = [...team1Data, ...team2Data].every((p) => p[3] && RANKING_POSITIONS.includes(p[3]));
    if (!allPositioned) continue;

    const team1Avg = team1Data.reduce((sum, p) => sum + p[2], 0) / team1Data.length;
    const team2Avg = team2Data.reduce((sum, p) => sum + p[2], 0) / team2Data.length;
    const team1Delta =
      match.winTeam === 1
        ? ratingCalculator.newRatingIfWon(team1Avg, team2Avg) - team1Avg
        : ratingCalculator.newRatingIfLost(team1Avg, team2Avg) - team1Avg;
    const team2Delta =
      match.winTeam === 2
        ? ratingCalculator.newRatingIfWon(team2Avg, team1Avg) - team2Avg
        : ratingCalculator.newRatingIfLost(team2Avg, team1Avg) - team2Avg;

    const teams = [
      { data: team1Data, won: match.winTeam === 1, delta: team1Delta },
      { data: team2Data, won: match.winTeam === 2, delta: team2Delta },
    ];
    for (const { data, won, delta } of teams) {
      for (const player of data) {
        const position = player[3];
        const puuid = player[0];
        if (!stats[puuid]) stats[puuid] = {};
        if (!stats[puuid][position]) stats[puuid][position] = { win: 0, lose: 0, ratingChange: 0 };
        const stat = stats[puuid][position];
        if (won) stat.win++;
        else stat.lose++;
        stat.ratingChange += delta;
      }
    }
  }

  // 전체 랭킹과 동일한 노출 규칙: outsider·서버 탈퇴 유저 제외
  const eligibleUsers = await models.user.findAll({
    where: { groupId: group.id, role: { [Op.ne]: 'outsider' }, leftGuildAt: null },
    attributes: ['puuid'],
  });
  const eligibleSet = new Set(eligibleUsers.map((u) => u.puuid));

  const puuids = Object.keys(stats);
  const summoners = await models.summoner.findAll({ where: { puuid: puuids } });
  const summonerMap = {};
  for (const s of summoners) summonerMap[s.puuid] = s.name;

  const toEntry = (puuid, stat) => {
    const games = stat.win + stat.lose;
    return {
      puuid,
      name: summonerMap[puuid] || 'Unknown',
      win: stat.win,
      lose: stat.lose,
      games,
      winRate: games > 0 ? Math.round((stat.win / games) * 100) : 0,
      ratingChange: Math.round(stat.ratingChange),
    };
  };

  const result = {};
  for (const position of RANKING_POSITIONS) {
    result[position] = puuids
      .filter((puuid) => {
        const stat = stats[puuid][position];
        return eligibleSet.has(puuid) && stat && stat.win + stat.lose >= RankingMinumumMatchCount;
      })
      .map((puuid) => toEntry(puuid, stats[puuid][position]))
      .sort((a, b) => b.ratingChange - a.ratingChange)
      .map((entry, index) => ({ ...entry, ranking: index + 1 }));
  }

  const response = { result, status: 200 };

  // 요청자 본인의 포지션별 기록 (랭킹 미포함 시 사유 표시)
  if (myPuuid && stats[myPuuid]) {
    const myUser = eligibleSet.has(myPuuid)
      ? null
      : await models.user.findOne({ where: { puuid: myPuuid, groupId: group.id } });

    const myRanking = {};
    for (const position of RANKING_POSITIONS) {
      const stat = stats[myPuuid][position];
      if (!stat) continue;
      const found = result[position].find((r) => r.puuid === myPuuid);
      if (found) {
        myRanking[position] = { ...found, reason: null };
        continue;
      }
      let reason = `${RankingMinumumMatchCount}판 미만`;
      if (!eligibleSet.has(myPuuid)) {
        reason = myUser && myUser.role === 'outsider' ? '블랙리스트' : '서버 탈퇴';
      }
      myRanking[position] = { ...toEntry(myPuuid, stat), ranking: null, reason };
    }
    response.myRanking = myRanking;
  }

  return response;
};
