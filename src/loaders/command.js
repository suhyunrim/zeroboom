const { SlashCommandBuilder } = require('discord.js');
const { logger } = require('./logger');
const fs = require('fs').promises;

const prefix = process.env.COMMAND_PREFIX || '';

class CommandList {
	commands;
	constructor() {
		this.commands = [];
	}

	push(command) {
		this.commands.push(command);
	}

	get(commandName) {
		// prefix 제거하고 찾기
		const name = prefix ? commandName.replace(prefix, '') : commandName;
		return this.commands.find(elem => elem.conf.aliases[0] == name);
	}

	getSlashCommands() {
		const ret = [];
		for (let command of this.commands) {
			const commandName = command.conf.aliases[0]; // 일단 첫번째 커맨드만
			const slashCommand = new SlashCommandBuilder().setName(prefix + commandName).setDescription(command.help.description);
			for (let argument of command.conf.args) {
				const isRequired = argument[3] !== false; // 기본값은 true
				const hasAutocomplete = argument[4] === 'autocomplete';
				if (argument[0] == 'string') {
					slashCommand.addStringOption(option =>
						option.setName(argument[1])
								.setDescription(argument[2])
								.setRequired(isRequired)
								.setAutocomplete(hasAutocomplete));
				} else if (argument[0] == 'boolean') {
					slashCommand.addBooleanOption(option =>
						option.setName(argument[1])
								.setDescription(argument[2])
								.setRequired(isRequired));
				} else if (argument[0] == 'user') {
					slashCommand.addUserOption(option =>
						option.setName(argument[1])
								.setDescription(argument[2])
								.setRequired(isRequired));
				} else if (argument[0] == 'channel') {
					slashCommand.addChannelOption(option =>
						option.setName(argument[1])
								.setDescription(argument[2])
								.setRequired(isRequired));
				} else if (argument[0] == 'integer') {
					slashCommand.addIntegerOption(option =>
						option.setName(argument[1])
								.setDescription(argument[2])
								.setRequired(isRequired));
				}
			}
			ret.push(slashCommand);
		}
		return ret;
	}
}

// 등록 여부 비교용 정규화: Discord GET 응답과 빌더 toJSON 양쪽을 같은 형태로 축약.
// Discord는 required/autocomplete가 false면 필드를 생략하므로 !!로 통일하고,
// 응답에만 붙는 부가 필드(id/version/localizations 등)는 비교에서 제외한다.
const normalizeCommands = (commandJsons) =>
	[...commandJsons]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
			options: (cmd.options || []).map((o) => ({
				type: o.type,
				name: o.name,
				description: o.description,
				required: !!o.required,
				autocomplete: !!o.autocomplete,
			})),
		}));

let commandList;
module.exports = async () => {
	if (commandList) {
		return commandList;
	}

	commandList = new CommandList();

	const files = await fs.readdir('./src/commands/');
	logger.info(`Loading a total of ${files.length} commands.`);
	for (let fileName of files) {
		const props = require(`../commands/${fileName}`);
		if (props.conf.enabled === false) {
			logger.info(`Command Skipped (disabled): ${props.help.name}`);
			continue;
		}
		logger.info(`Command Loaded! ${props.help.name} 👌`);
		commandList.push(props);
	}
	return commandList;
}

module.exports.normalizeCommands = normalizeCommands;
