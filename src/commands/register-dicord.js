const models = require('../db/models');
const { REST, Routes } = require('discord.js');
const commandLoader = require('../loaders/command.js');

exports.run = async (groupName, interaction) => {
  const guildId = interaction.commandGuildId;
  const groupByGuildId = await models.group.findOne({
    where: { discordGuildId: guildId },
  });
  if (groupByGuildId) {
    return `이 방은 이미 [${groupByGuildId.groupName}]로 등록되어 있습니다.`;
  }

  const groupByGroupName = await models.group.findOne({
    where: { groupName },
  });
  if (
    groupByGroupName &&
    groupByGroupName.discordGuildId &&
    groupByGroupName.discordGuildId !== ''
  ) {
    return '이미 등록되어 있는 방입니다.';
  }

  await models.group.create({
    groupName,
    discordGuildId: guildId,
  });

  const commandList = await commandLoader();
  const commandJsons = commandList
    .getSlashCommands()
    .map((command) => command.toJSON());
  const rest = new REST({ version: '10' }).setToken(
    process.env.DISCORD_BOT_TOKEN,
  );
  rest
    .put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_APPLICATION_ID,
        guildId,
      ),
      { body: commandJsons },
    )
    .then((data) =>
      console.log(
        `Successfully registered ${data.length} application commands.`,
      ),
    )
    .catch(console.error);

  return `이 디스코드 방은 [${groupName}]으로 등록되었습니다.`;
};

exports.conf = {
  enabled: true,
  requireGroup: false,
  aliases: ['방등록'],
  args: [['string', '방이름', '세팅할 방이름을 입력해주세요.', true]],
};

exports.help = {
  name: 'register-discord',
  description: 'register discord.',
  usage: 'register-discord roomName',
};
