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
      return;
    }

    return found.accountId;
  } catch (e) {
    logger.error(e);
    return;
  }
};
