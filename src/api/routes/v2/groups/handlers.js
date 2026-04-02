const handler = require('../../../middlewares/handler');

const { get, getByDiscordGuildId } = require('../../../../controller/group');

function getGuildIconUrl(discordClient, discordGuildId) {
  if (!discordClient || !discordGuildId) return null;
  const guild = discordClient.guilds.cache.get(discordGuildId);
  return guild ? guild.iconURL({ size: 128 }) : null;
}

module.exports.get = handler(
  async ({
    app: { discordClient },
    params: { id },
  }) => {
    const result = await get(id);
    const data = result.dataValues || result;
    data.iconUrl = getGuildIconUrl(discordClient, data.discordGuildId);
    return data;
  },
);

module.exports.getByDiscordGuildId = handler(
  async ({
    app: { discordClient },
    params: { id },
  }) => {
    const result = await getByDiscordGuildId(id);
    const data = result.dataValues || result;
    data.iconUrl = getGuildIconUrl(discordClient, data.discordGuildId);
    return data;
  },
);
