function getGuildIconUrl(discordClient, discordGuildId) {
  if (!discordClient || !discordGuildId) return null;
  const guild = discordClient.guilds.cache.get(discordGuildId);
  return guild ? guild.iconURL({ size: 128 }) : null;
}

module.exports = { getGuildIconUrl };
