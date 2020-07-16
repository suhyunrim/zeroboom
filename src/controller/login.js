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

  const userInfos = await models.user.findAll({
    where: { accountId: accountId },
  });

  const groupIds = userInfos.map((elem) => elem.groupId);
  const groups = await models.group.findAll({ where: { id: groupIds } });

  let result = [];
  for (const group of groups)
  {
    const userInfo = userInfos.find((elem) => elem.groupId == group.id);
    result.push({
      groupName: group.groupName,
      defaultRating: userInfo.defaultRating,
      additionalRating: userInfo.additionalRating,
      win: userInfo.win,
      lose: userInfo.lose,
    })
  }

  return { result: result, status: 200 };
};
