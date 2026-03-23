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
				if (argument[0] == 'string') {
					slashCommand.addStringOption(option =>
						option.setName(argument[1])
								.setDescription(argument[2])
								.setRequired(isRequired));
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
		logger.info(`Command Loaded! ${props.help.name} 👌`);
		commandList.push(props);
	}
	return commandList;
}
