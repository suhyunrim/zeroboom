const models = require('../db/models');

exports.run = async ({ message, args }) => {
  const guildId = message.guild.id;
  const groupByGuildId = await models.group.findOne({
    where: { discordGuildId: guildId },
  });
  if (groupByGuildId) {
    return `이 방은 이미 ${groupByGuildId.groupName}로 등록되어 있습니다.`;
  }

  const groupName = args[0];
  const groupByGroupName = await models.group.findOne({
    where: { groupName },
  });
  if (!groupByGroupName) {
    return '존재하지 않는 그룹 이름입니다.';
  }

  if (
    groupByGroupName.discordGuildId &&
    groupByGroupName.discordGuildId !== ''
  ) {
    return '이미 등록되어 있는 방입니다.';
  }

  groupByGroupName.discordGuildId = guildId;
  groupByGroupName.update(groupByGroupName.dataValues);

  return `이 디스코드 방은 [${groupName}]으로 등록되었습니다.`;
};

exports.conf = {
  enabled: true,
  requireGroup: false,
  aliases: ['방등록'],
};

exports.help = {
  name: 'register-discord',
  description: 'register discord.',
  usage: 'register-discord roomName',
};
