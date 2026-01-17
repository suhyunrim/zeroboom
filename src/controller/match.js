const models = require('../db/models');
const moment = require('moment');
const { Op } = require('sequelize');
const table = require('table');

const summonerController = require('../controller/summoner');

const elo = require('arpad');
const {
  getSummonerByName_V1,
  getCustomGames,
  getMatchData,
} = require('../services/riot-api');
const { logger } = require('../loaders/logger');

const ratingCalculator = new elo(16);
const matchMaker = require('../match-maker/match-maker');
const User = require('../entity/user').User;
const { formatTier } = require('../utils/tierUtils');

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
    const until = latestGameCreation
      ? latestGameCreation.gameCreation
      : new Date(new Date().getFullYear(), 0);
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
        simpleMatchData.gameCreation >= newLatestGameCreation
          ? simpleMatchData.gameCreation
          : newLatestGameCreation;

      const gameId = simpleMatchData.gameId;
      if (matchIdsInDB.find((elem) => elem === gameId)) continue;

      const matchData = await getMatchData(tokenId, gameId);
      if (!matchData || matchData.team1.length + matchData.team2.length !== 10)
        continue;

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

  const getRating = async (summonerName) => {
    const summoner = await models.summoner.findOne({
      where: { name: summonerName },
    });
    const user = await models.user.findOne({
      where: {
        groupId: group.id,
        puuid: summoner.puuid,
      },
    });
    return user.defaultRating + user.additionalRating;
  };

  let team1RatingMap = {};
  for (const summonerName of team1)
    team1RatingMap[summonerName] = await getRating(summonerName);

  let team2RatingMap = {};
  for (const summonerName of team2)
    team2RatingMap[summonerName] = await getRating(summonerName);

  const team1Rating =
    Object.values(team1RatingMap).reduce((total, current) => total + current) /
    5;
  const team2Rating =
    Object.values(team2RatingMap).reduce((total, current) => total + current) /
    5;
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

module.exports.generateMatch = async (
  groupName,
  team1Names,
  team2Names,
  userPool,
  matchCount,
) => {
  try {
    if (team1Names.length + team2Names.length + userPool.length !== 10) {
      throw '자동매칭에 필요한 유저 수는 10명입니다.';
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

    const matchingGames = matchMaker.matchMake(
      preOrganizationTeam1,
      preOrganizationTeam2,
      makerUserPool,
      matchCount,
    );
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
      groupId: {[Op.eq]: group.id},
      winTeam: {[Op.ne]: null},
      // gameCreation: {
      //   [Op.gte]: usableMatchDate
      // }
    },
  });

  matches.sort((a, b) => a.gameCreation > b.gameCreation);

  const groupUsers = await models.user.findAll({
    where: {
      groupId: group.id
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
      team1Delta =
        ratingCalculator.newRatingIfWon(team1Rating, team2Rating) - team1Rating;
      team2Delta =
        ratingCalculator.newRatingIfLost(team2Rating, team1Rating) -
        team2Rating;
    } else {
      team1Delta =
        ratingCalculator.newRatingIfLost(team1Rating, team2Rating) -
        team1Rating;
      team2Delta =
        ratingCalculator.newRatingIfWon(team2Rating, team1Rating) - team2Rating;
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

module.exports.getMatchHistory = async (groupName, from, to) => {
  if (!groupName) return { status: 900, result: 'invalid group name' };

  const group = await models.group.findOne({ where: { groupName: groupName } });
  if (!group) return { status: 901, result: 'group is not exist' };

  const users = await models.user.findAll({
    where: {
      groupId: group.id,
      latestMatchDate: {
        [Op.gte]: moment().subtract(60, 'days').toDate()
      }
    },
  });

  const puuIds = users.map((elem) => elem.puuid);

  const matches = await models.match.findAll({ where: {
    groupId: group.id,
    winTeam: {[Op.ne]: null},
    createdAt: {
      [Op.gte]: from,
      [Op.lte]: to,
    }
  }});

  const nameCache = {};

  const matchPlayCountMap = {};
  const fixedMatchPlayCountMap = {};
  for (let match of matches) {
    const participants = match.team1.concat(match.team2);
    for (let participant of participants) {
      const puuid = participant[0];
      if (nameCache[puuid] == null) {
        const summoner = await models.summoner.findOne({ where: { puuid } });
        if (!summoner)
          continue;

        nameCache[puuid] = summoner.name;
      }

      const name = nameCache[puuid];
      matchPlayCountMap[name] = (matchPlayCountMap[name] || 0) + 1;

      const weekDay = moment(match.createdAt).isoWeekday();
      if (weekDay == 3 || weekDay == 7) {
        fixedMatchPlayCountMap[name] = (fixedMatchPlayCountMap[name] || 0) + 1;
      }
    }
  }

  const riotMatches = await models.riot_match.findAll({ where: {
    gameCreation: {
      [Op.gte]: from,
      [Op.lte]: to,
    }
  }});

  const riotMatchSet = {};
  const riotMatchPlayCountMap = {};
  for (let match of riotMatches) {
    const filtered = match.participants.filter((elem) => puuIds.includes(elem));
    if (filtered.length <= 1)
      continue;

    for (let puuId of filtered) {
      if (nameCache[puuId] == null) {
        const summoner = await models.summoner.findOne({ where: { puuId } });
        nameCache[puuId] = summoner.name;
      }
      
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
    if (!name)
      continue;

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
    border: table.getBorderCharacters("ramac"),
    columns: {
      0: { alignment: 'center', width: 5 },
      1: { alignment: 'center', width: 20 },
      2: { alignment: 'center', width: 10 },
      3: { alignment: 'center', width: 10 },
      4: { alignment: 'center', width: 10 },
      5: { alignment: 'center', width: 10 },
    }
  }

  const matchCountCondition = 4;
  const riotMatchCountCondition = 8;

  const completedTableData = [['No', '닉네임', '내전', '롤데인', '합산']];
  let rank = 1;
  for (let elem of result.filter(elem => elem.matchPlayCount >= matchCountCondition || elem.riotMatchPlayCount >= riotMatchCountCondition)) {
    completedTableData.push([rank++, elem.name, elem.matchPlayCount, elem.riotMatchPlayCount, elem.point]);
  }

  const uncompletedTableConfig = {
    border: table.getBorderCharacters("ramac"),
    columns: {
      0: { alignment: 'center', width: 20 },
      1: { alignment: 'center', width: 10 },
      2: { alignment: 'center', width: 10 },
      3: { alignment: 'center', width: 10 },
      4: { alignment: 'center', width: 10 },
    }
  }

  const uncompletedTableData = [['닉네임', '내전', '롤데인', '합산']];
  for (let elem of result.filter(elem => elem.matchPlayCount < matchCountCondition && elem.riotMatchPlayCount < riotMatchCountCondition)) {
    uncompletedTableData.push([elem.name, elem.matchPlayCount, elem.riotMatchPlayCount, elem.point]);
  }

  let msg = `<pre><h1>달성자</h1>${table.table(completedTableData, completedTableConfig)}<br><h1>미달성자</h1>${table.table(uncompletedTableData, uncompletedTableConfig)}</pre>`
  msg = msg.replaceAll('\n', '<br>');

  return {
    result: msg,
    status: 200,
  }
}

module.exports.getMatchHistoryByGroupId = async (groupId) => {
  const group = await models.group.findByPk(groupId);
  if (!group) {
    return { status: 404, result: { error: 'Group not found' } };
  }

  // 해당 그룹의 모든 유저 조회
  const groupUsers = await models.user.findAll({
    where: { groupId: group.id },
  });

  // 유저별 현재 레이팅 상태 초기화 (defaultRating에서 시작)
  const userRatings = {};
  for (const user of groupUsers) {
    userRatings[user.puuid] = user.defaultRating;
  }

  // 해당 그룹의 완료된 모든 매치를 시간순(오래된 순)으로 조회
  const matches = await models.match.findAll({
    where: {
      groupId: group.id,
      winTeam: { [Op.ne]: null },
    },
    order: [['createdAt', 'ASC']],
  });

  // 소환사 이름 캐시
  const summonerCache = {};
  const getSummonerName = async (puuid) => {
    if (!summonerCache[puuid]) {
      const summoner = await models.summoner.findOne({ where: { puuid } });
      summonerCache[puuid] = summoner ? summoner.name : 'Unknown';
    }
    return summonerCache[puuid];
  };

  // 매치별 스냅샷 저장
  const matchSnapshots = [];

  for (const match of matches) {
    const team1Data = match.team1; // [[puuid, savedRating], ...]
    const team2Data = match.team2;

    // 팀 플레이어 정보 구성 (현재 시점의 레이팅 사용)
    const buildTeamPlayers = async (teamData) => {
      const players = [];
      let totalRating = 0;
      let validCount = 0;

      for (const [puuid] of teamData) {
        const rating = userRatings[puuid] ?? 500; // 그룹에 없는 유저는 기본값 500
        const name = await getSummonerName(puuid);
        const tier = formatTier(rating);

        players.push({ name, rating: Math.round(rating), tier });
        totalRating += rating;
        validCount++;
      }

      return {
        players,
        avgRating: validCount > 0 ? Math.round(totalRating / validCount) : 0,
      };
    };

    const team1 = await buildTeamPlayers(team1Data);
    const team2 = await buildTeamPlayers(team2Data);

    // 레이팅 증감 계산
    const team1AvgRating = team1.avgRating;
    const team2AvgRating = team2.avgRating;

    let team1RatingChange, team2RatingChange;
    if (match.winTeam === 1) {
      team1RatingChange = ratingCalculator.newRatingIfWon(team1AvgRating, team2AvgRating) - team1AvgRating;
      team2RatingChange = ratingCalculator.newRatingIfLost(team2AvgRating, team1AvgRating) - team2AvgRating;
    } else {
      team1RatingChange = ratingCalculator.newRatingIfLost(team1AvgRating, team2AvgRating) - team1AvgRating;
      team2RatingChange = ratingCalculator.newRatingIfWon(team2AvgRating, team1AvgRating) - team2AvgRating;
    }

    // 스냅샷 저장
    matchSnapshots.push({
      gameId: match.gameId,
      createdAt: match.createdAt,
      winTeam: match.winTeam,
      team1: {
        players: team1.players,
        avgRating: team1.avgRating,
        ratingChange: Math.round(team1RatingChange),
      },
      team2: {
        players: team2.players,
        avgRating: team2.avgRating,
        ratingChange: Math.round(team2RatingChange),
      },
    });

    // 유저별 레이팅 업데이트 (다음 매치를 위해)
    for (const [puuid] of team1Data) {
      if (userRatings[puuid] !== undefined) {
        userRatings[puuid] += team1RatingChange;
      }
    }
    for (const [puuid] of team2Data) {
      if (userRatings[puuid] !== undefined) {
        userRatings[puuid] += team2RatingChange;
      }
    }
  }

  // 최근 순으로 정렬
  matchSnapshots.reverse();

  return {
    status: 200,
    result: {
      matches: matchSnapshots,
      total: matchSnapshots.length,
    },
  };
};