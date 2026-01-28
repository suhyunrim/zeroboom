const models = require('../db/models');
const { logger } = require('../loaders/logger');
const moment = require('moment');
const { Op } = require('sequelize');

const LatestMatchDateConditionDays = 60;
const RankingMinumumMatchCount = 5;

const matchController = require('../controller/match');

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

module.exports.retrieveMatches = async (groupName) => {
  const group = await models.group.findOne({ where: { groupName } });
  if (!group) return { result: 'group is not exist' };

  try {
    const users = await models.user.findAll({ where: { groupId: group.id } });
    const accountIds = users.map((elem) => elem.accountId);
    const tokens = await models.token.findAll({
      where: { accountId: accountIds },
    });

    for (const token of tokens) {
      const data = token.dataValues;
      await matchController.registerMatch(data.token, data.name);
    }
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }

  return { status: 200 };
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
      latestMatchDate: {
        [Op.gte]: moment().subtract(LatestMatchDateConditionDays, 'days').toDate()
      }
    },
  });

  // 만료되지 않은 외부 기록 조회
  const externalRecords = await models.externalRecord.findAll({
    where: {
      groupId: group.id,
      expiresAt: { [Op.gt]: new Date() },
    },
  });

  // puuid별 외부 기록 합산
  const externalStats = {};
  for (const record of externalRecords) {
    if (!externalStats[record.puuid]) {
      externalStats[record.puuid] = { win: 0, lose: 0 };
    }
    externalStats[record.puuid].win += record.win || 0;
    externalStats[record.puuid].lose += record.lose || 0;
  }

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
