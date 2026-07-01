const { EmbedBuilder } = require('discord.js');
const models = require('../db/models');
const { logger } = require('../loaders/logger');

/**
 * 감지된 닉네임 변경 목록을 그룹별로 설정된 채널(settings.nicknameChangeChannelId)에 알림
 * 그룹에 채널이 설정되어 있지 않으면 해당 그룹 몫은 알림하지 않는다.
 * @param {import('discord.js').Client} client
 * @param {Array<{puuid: string, from: string, to: string}>} nameChanges
 */
async function sendNicknameChangeNotification(client, nameChanges) {
  if (!nameChanges || nameChanges.length === 0) return;

  try {
    const puuids = [...new Set(nameChanges.map((c) => c.puuid))];
    const users = await models.user.findAll({
      where: { puuid: puuids },
      attributes: ['puuid', 'groupId', 'discordId'],
    });
    if (users.length === 0) return;

    const groupIds = [...new Set(users.map((u) => u.groupId))];
    const groups = await models.group.findAll({
      where: { id: groupIds },
      attributes: ['id', 'groupName', 'settings'],
    });
    const groupById = new Map(groups.map((g) => [g.id, g]));

    const groupIdsByPuuid = new Map();
    const discordIdByPuuidAndGroup = new Map();
    users.forEach((u) => {
      const ids = groupIdsByPuuid.get(u.puuid) || [];
      ids.push(u.groupId);
      groupIdsByPuuid.set(u.puuid, ids);
      discordIdByPuuidAndGroup.set(`${u.puuid}|${u.groupId}`, u.discordId);
    });

    // 채널ID별로 알림 문구를 모아서 채널당 한 번만 전송
    const linesByChannelId = new Map();
    nameChanges.forEach((change) => {
      const groupIds2 = groupIdsByPuuid.get(change.puuid) || [];
      groupIds2.forEach((groupId) => {
        const group = groupById.get(groupId);
        const channelId = group?.settings?.nicknameChangeChannelId;
        if (!channelId) return;

        const discordId = discordIdByPuuidAndGroup.get(`${change.puuid}|${groupId}`);
        const mention = discordId ? `<@${discordId}> ` : '';
        const line = `${mention}**${change.from}** → **${change.to}**`;
        const lines = linesByChannelId.get(channelId) || [];
        lines.push(line);
        linesByChannelId.set(channelId, lines);
      });
    });

    for (const [channelId, lines] of linesByChannelId) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased?.()) {
        logger.warn(`[닉변 알림] 채널(${channelId})을 찾을 수 없거나 텍스트 채널이 아닙니다.`);
        continue;
      }

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🔄 닉네임 변경 감지')
        .setDescription(lines.join('\n'));

      await channel.send({ embeds: [embed] }).catch((e) => {
        logger.error(`[닉변 알림] 채널(${channelId}) 전송 실패: ${e.message}`);
      });
    }
  } catch (e) {
    logger.error(`[닉변 알림] 처리 실패: ${e.message}`);
  }
}

module.exports = { sendNicknameChangeNotification };
