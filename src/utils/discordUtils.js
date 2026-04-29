function getGuildIconUrl(discordClient, discordGuildId) {
  if (!discordClient || !discordGuildId) return null;
  const guild = discordClient.guilds.cache.get(discordGuildId);
  return guild ? guild.iconURL({ size: 128 }) : null;
}

/**
 * Discord 유저 아바타 URL (client 캐시 기준).
 * cache miss / 에러 시 null.
 */
function getUserAvatarUrl(discordClient, discordId, size = 64) {
  if (!discordClient || !discordId) return null;
  const user = discordClient.users.cache.get(discordId);
  if (!user) return null;
  try {
    return user.displayAvatarURL({ size, extension: 'png' });
  } catch (e) {
    return null;
  }
}

module.exports = { getGuildIconUrl, getUserAvatarUrl };
