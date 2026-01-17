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
  const pickUsersData = new Map();

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

        // 인원뽑기 관련 명령어 버튼 데이터 저장
        const pickCommands = ['인원뽑기', '랜덤인원뽑기', '테스트_인원뽑기'];
        if (pickCommands.includes(command.conf.aliases[0]) && typeof output === 'object' && output.components) {
          const timeKey = output.components[0].components[0].data.custom_id.split('|')[1];

          if (output.isToggleMode) {
            // 토글 모드 데이터 저장
            pickUsersData.set(timeKey, {
              isToggleMode: true,
              memberList: output.memberList,
              excludedNames: output.excludedNames,
              groupName: output.groupName,
              channelName: output.channelName,
            });
          } else if (output.pickedUsers) {
            // 결과 모드 데이터 저장
            pickUsersData.set(timeKey, {
              pickedUsers: output.pickedUsers,
              commandStr: output.commandStr,
            });
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

    try {
      const split = interaction.customId.split('|');

      // pickToggle 버튼 (토글 모드)
      if (split[0] === 'pickToggle') {
        const timeKey = split[1];
        const memberName = split[2];
        const data = pickUsersData.get(timeKey);

        if (!data || !data.isToggleMode) {
          await interaction.reply({ content: '데이터가 만료되었습니다. 다시 인원뽑기를 해주세요.', ephemeral: true });
          return;
        }

        // 인원뽑기 또는 테스트_인원뽑기 명령어 사용
        const pickUsersCommand = commandList.get('인원뽑기') || commandList.get('테스트_인원뽑기');

        if (memberName === 'start') {
          // 뽑기 시작
          const output = await pickUsersCommand.executePick(interaction, data);
          if (output.pickedUsers) {
            // 결과 데이터 저장 (복사/매칭 버튼용)
            const newTimeKey = output.components[0].components[0].data.custom_id.split('|')[1];
            pickUsersData.set(newTimeKey, {
              pickedUsers: output.pickedUsers,
              commandStr: output.commandStr,
            });
          }
          await interaction.update(output);
        } else {
          // 멤버 토글
          const output = await pickUsersCommand.handleToggle(interaction, data, memberName);
          // 업데이트된 제외 목록 저장
          data.excludedNames = output.excludedNames;
          pickUsersData.set(timeKey, data);
          await interaction.update(output);
        }
        return;
      }

      // pickUsers 버튼 (결과 화면 - 인원뽑기, 랜덤인원뽑기 공용)
      if (split[0] === 'pickUsers') {
        const timeKey = split[1];
        const action = split[2];
        const data = pickUsersData.get(timeKey);
        if (data) {
          const pickUsersCommand = commandList.get('인원뽑기') || commandList.get('랜덤인원뽑기');
          const output = await pickUsersCommand.reactButton(interaction, data);
          if (output) {
            await interaction.reply(output);
          }
        } else {
          await interaction.reply({ content: '데이터가 만료되었습니다. 다시 인원뽑기를 해주세요.', ephemeral: true });
        }
        return;
      }

      // winCommand 버튼 체크
      if (split[0] === 'winCommand') {
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
        return;
      }

      // 기타 명령어의 버튼 (매칭생성 등)
      let command;
      if (interaction.message.interaction) {
        command = commandList.get(interaction.message.interaction.commandName);
      }

      if (command) {
        const match = matches.get(interaction.customId);
        const output = await command.reactButton(interaction, match);
        if (output) {
          await interaction.reply(output);
        }
      }
    } catch (e) {
      logger.error(e);
    }
  });

  // Select Menu 핸들러
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu()) {
      return;
    }

    const commandList = await commandListLoader();

    try {
      const split = interaction.customId.split('|');

      // 추후 Select Menu 핸들러 추가 예정
    } catch (e) {
      logger.error(e);
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
    '1235540411230191626',
  ];

  for (let serverId of serverIds) {
    rest
      .put(Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, serverId), {
        body: commandJsons,
      })
      .then((data) => console.log(`[${serverId}] Successfully registered ${data.length} application commands.`))
      .catch(console.error);
  }
};
