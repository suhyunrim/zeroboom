const models = require('../db/models');
const { logger } = require('../loaders/logger');

module.exports.getAccountId = async (token) => {
  try {
    const found = await models.token.findOne({
      where: {
        token,
      },
      raw: true,
    });

    if (!found) {
      throw `not exist account id tokne: ${token}`;
    }

    return found.accountId;
  } catch (e) {
    logger.error(e);
  }
};

module.exports.validateUserGroup = async (token, groupName) => {
  try {
    const group = await models.group.findOne({
      where: { groupName },
      raw: true,
    });

    if (!group) {
      throw `not exist group. group name: ${groupName}`;
    }

    const accountId = await this.getAccountId(token);
    const isExistUserInGroup =
      (await models.user.findOne({
        where: { groupId: group.id, accountId },
        raw: true,
      })) !== undefined;

    if (!isExistUserInGroup) {
      throw `invalid user. accountId:${accountId} groupName:${groupName}`;
    }
  } catch (e) {
    logger.error(e);
    return false;
  }
};
