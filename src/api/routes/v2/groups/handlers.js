const handler = require('../../../middlewares/handler');

const { get, getByDiscordGuildId } = require('../../../../controller/group');
const { getGuildIconUrl } = require('../../../../utils/discordUtils');

module.exports.get = handler(
  async ({
    app: { discordClient },
    params: { id },
  }) => {
    const result = await get(id);
    return { ...(result.dataValues || result), iconUrl: getGuildIconUrl(discordClient, result.discordGuildId) };
  },
);

module.exports.getByDiscordGuildId = handler(
  async ({
    app: { discordClient },
    params: { id },
  }) => {
    const result = await getByDiscordGuildId(id);
    return { ...(result.dataValues || result), iconUrl: getGuildIconUrl(discordClient, result.discordGuildId) };
  },
);
