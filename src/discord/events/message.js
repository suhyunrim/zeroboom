const { logger } = require('../../loaders/logger');
const models = require('../../db/models');

module.exports = async (app, message) => {
  if (message.author.bot) {
    return;
  }

  const prefix = '/';

  if (!message.content.startsWith(prefix)) {
    return;
  }

  const command = message.content.split(' ')[0].slice(prefix.length);

  let cmd;
  if (app.commands.has(command)) {
    cmd = app.commands.get(command);
  } else if (app.aliases.has(command)) {
    cmd = app.commands.get(app.aliases.get(command));
  }

  if (!cmd) {
    return;
  }

  try {
    let groupName;
    if (cmd.conf.requireGroup) {
      const group = await models.group.findOne({
        where: { discordGuildId: message.guild.id },
      });
      groupName = group ? group.groupName : '';

      if (groupName === '') {
        message.channel.send(
          '[Error] 방 등록을 해주세요. 사용법: /방등록 그룹이름',
        );
        return;
      }
    }

    const args = message.content.split(' ').slice(1);
    const output = await cmd.run({ message, groupName, args });
    if (output) {
      message.channel.send(output);
    }
  } catch (e) {
    logger.error(e);
    return `[Error] ${cmd.help.name}`;
  }
};
