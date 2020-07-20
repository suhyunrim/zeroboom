const models = require('../db/models');
const { logger } = require('../loaders/logger');

module.exports.login = async (name, accountId, token) => {
  let found = await models.token.findOne({
    where: {
      accountId: accountId,
    },
  });

  const tokenData = {
    name: name,
    accountId: accountId,
    token: token,
  };

  try {
    if (!found) {
      const created = await models.token.create(tokenData);
      return { result: created, status: 200 };
    } else if (found.token !== token || found.name !== name) {
      await found.update(tokenData);
    }
  } catch (e) {
    logger.error(e.stack);
    return { result: found || e.message, status: 501 };
  }

  return { result: found, status: 200 };
};

module.exports.getGroupList = async (accountId) => {
  let result = [];
  try {
    const userInfos = await models.user.findAll({
      where: { accountId: accountId },
    });

    const groupIds = userInfos.map((elem) => elem.groupId);
    const groups = await models.group.findAll({ where: { id: groupIds } });

    for (const group of groups) {
      const userInfo = userInfos.find((elem) => elem.groupId == group.id);
      result.push({
        groupId: group.id,
        groupName: group.groupName,
        defaultRating: userInfo.defaultRating,
        additionalRating: userInfo.additionalRating,
        win: userInfo.win,
        lose: userInfo.lose,
      });
    }
  } catch (e) {
    logger.error(e.stack);
    return { result: result || e.message, status: 501 };
  }

  return { result, statusCode: 200 };
};

module.exports.getInfo = async (groupId, accountId) => {
  if (!groupId) return { result: 'invalid groupId', status: 501 };
  if (!accountId) return { result: 'invalid accountId', status: 501 };

  try {
    let userInfo = await models.user.findOne({
      where: {
        groupId,
        accountId,
      },
    });

    if (!userInfo) {
      return { result: 'user is not exist', status: 501 };
    }

    return { result: userInfo, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};
