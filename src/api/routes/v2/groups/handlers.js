const handler = require('../../../middlewares/handler');

const { get, getByDiscordGuildId } = require('../../../../controller/group');

module.exports.get = handler(
  async ({
    // headers,
    // connection: { remoteAddress },
    params: { id },
  }) => {
    // const address = headers['x-forwarded-for'] || remoteAddress;

    const result = await get(id);
    return result;
  },
);

module.exports.getByDiscordGuildId = handler(
  async ({
    // headers,
    // connection: { remoteAddress },
    params: { id },
  }) => {
    // const address = headers['x-forwarded-for'] || remoteAddress;

    const result = await getByDiscordGuildId(id);
    return result;
  },
);
