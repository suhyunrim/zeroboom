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
    },
  });

  users = users.filter((elem) => elem.win + elem.lose >= RankingMinumumMatchCount);

  users.sort((a, b) => b.defaultRating + b.additionalRating - (a.defaultRating + a.additionalRating));

  const userIds = users.map((elem) => elem.riotId);
  const summoners = await models.summoner.findAll({
    where: { riotId: userIds },
  });
  const summonerObj = summoners.reduce((obj, v) => {
    obj[v.riotId] = v;
    return obj;
  }, {});

  let result = users.map((elem, index) => {
    return {
      riotId: elem.riotId,
      ranking: index + 1,
      rating: elem.defaultRating + elem.additionalRating,
      win: elem.win,
      lose: elem.lose,
      winRate: Math.ceil((elem.win / (elem.win + elem.lose)) * 100),
    };
  });

  result.forEach((user) => {
    user.name = summonerObj[user.riotId].name;
  });

  return { result: result, status: 200 };
};
