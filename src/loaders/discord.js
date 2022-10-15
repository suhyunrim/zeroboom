const { Client, GatewayIntentBits,REST, Routes } = require('discord.js');
const commandListLoader = require('./command.js');
const { logger } = require('./logger');
const models = require('../db/models');
const matchController = require('../controller/match');

module.exports = async (app) => {
	const client  = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions] });

	client.on('interactionCreate', async interaction => {
		if (!interaction.isChatInputCommand()) return;

		const commandList = await commandListLoader();
		const command = commandList.get(interaction.commandName);

		try {
			let groupName;
			if (command.conf.requireGroup) {
				const group = await models.group.findOne({
					where: { discordGuildId: interaction.guildId },
				});
				groupName = group ? group.groupName : '';

				if (groupName === '') {
					interaction.reply(
					'[Error] 방 등록을 해주세요. 사용법: /방등록 그룹이름',
					);
					return;
				}
			}

			const output = await command.run(groupName, interaction);
			if (output) {
				interaction.reply(output);
			}
		} catch (e) {
			logger.error(e);
			return `[Error] ${command.help.name}`;
		}
	});

	// 일단은 매치 나온 거 1~6 버튼 선택에 대한 로직만 있음 (by zeroboom)
	client.on('interactionCreate', async interaction => {
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
				const output = await command.reactButton(interaction);
				if (output) {
					interaction.reply(output);
				}
			} else if (interaction.customId) {
				const split = interaction.customId.split('|');
				if (split.length > 0) {
					if (split[0] == 'winCommand') {
						const group = await models.group.findOne({where: { discordGuildId: interaction.guildId }});
						const matchData = await models.match.findOne({where: {gameId: Number(split[1])}});
						await matchData.update({ winTeam: Number(split[2])});
						await matchController.calculateRating(group.groupName);
						interaction.reply('완료');
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
	const commandJsons = commandList.getSlashCommands().map(command => command.toJSON());
	  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
	  rest.put(Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, '280311002656931844'), { body: commandJsons })
		.then((data) => console.log(`Successfully registered ${data.length} application commands.`))
		.catch(console.error);
}
