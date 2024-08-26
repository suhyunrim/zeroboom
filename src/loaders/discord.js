const { Client, GatewayIntentBits, REST, Routes, ComponentType, InteractionResponse } = require('discord.js');
const commandListLoader = require('./command.js');
const { logger } = require('./logger');
const models = require('../db/models');
const matchController = require('../controller/match');

module.exports = async (app) => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  const matches = new Map();

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const commandList = await commandListLoader();
    const command = commandList.get(interaction.commandName);

    try {
      let groupName;
      if (command.conf.aliases[0] == '방등록') {
        groupName = interaction.options.data[0].value;
      } else {
        if (command.conf.requireGroup) {
          const group = await models.group.findOne({
            where: { discordGuildId: interaction.guildId },
          });
          groupName = group ? group.groupName : '';

          if (groupName === '') {
            interaction.reply('[Error] 방 등록을 해주세요. 사용법: /방등록 그룹이름');
            return;
          }
        }
      }

      const output = await command.run(groupName, interaction);
      if (output) {
        if (command.conf.aliases[0] == '매칭생성') {
          for (let i = 0; i < output.match.length; ++i) {
            matches.set(`${groupName}/${output.time}/${i}`, output.match[i]);
          }
        }

        const replied = await interaction.reply(output);
        // const collector = replied.createMessageComponentCollector({
        //   componentType: ComponentType.Button,
        // });

        // collector.on('collect', async (interaction) => {
        //   await replied.edit({ components: [] });
        // });
      }
    } catch (e) {
      logger.error(e);
      return `[Error] ${command.help.name}`;
    }
  });

  // 일단은 여기에 로직들 넣어둠.. (by zeroboom)
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) {
      return;
    }

    const commandList = await commandListLoader();
    let command;

    if (interaction.message.interaction) {
      command = commandList.get(interaction.message.interaction.commandName);
    }

    try {
      if (command) {
        const match = matches.get(interaction.customId);
        const output = await command.reactButton(interaction, match);
        if (output) {
          await interaction.reply(output);
        }
      } else if (interaction.customId) {
        const split = interaction.customId.split('|');
        if (split.length > 0) {
          if (split[0] == 'winCommand') {
            const group = await models.group.findOne({
              where: { discordGuildId: interaction.guildId },
            });
            const matchData = await models.match.findOne({
              where: { gameId: Number(split[1]) },
            });
            const winTeam = Number(split[2]);
            await matchData.update({ winTeam });
            await matchController.calculateRating(group.groupName);
            const teamEmoji = winTeam == 1 ? '🐶' : '🐱';
            await interaction.reply(
              `${teamEmoji}팀이 **승리**하였습니다! 레이팅에 반영 되었습니다. (by ${interaction.member.nickname})`,
            );
          }
        }
      }
    } catch (e) {
      logger.error(e);
      return `[Error] ${command.help.name}`;
    }
  });

  client.login(process.env.DISCORD_BOT_TOKEN);

  const commandList = await commandListLoader();
  const commandJsons = commandList.getSlashCommands().map((command) => command.toJSON());
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

  const serverIds = [
    '635802085601968158', // 협곡에휘핑크림
    '280311002656931844', // 롤리데이
    '765934529231716365', // LRZ
  ];

  for (let serverId of serverIds) {
    rest
      .put(Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, serverId), {
        body: commandJsons,
      })
      .then((data) => console.log(`Successfully registered ${data.length} application commands.`))
      .catch(console.error);
  }
};
