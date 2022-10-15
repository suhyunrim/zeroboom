const { SlashCommandBuilder } = require('discord.js');
const { logger } = require('./logger');
const fs = require('fs').promises;

class CommandList {
	commands;
	constructor() {
		this.commands = [];
	}

	push(command) {
		this.commands.push(command);
	}

	get(commandName) {
		return this.commands.find(elem => elem.conf.aliases[0] == commandName);
	}

	getSlashCommands() {
		const ret = [];
		for (let command of this.commands) {
			const commandName = command.conf.aliases[0]; // 일단 첫번째 커맨드만
			const slashCommand = new SlashCommandBuilder().setName(commandName).setDescription(command.help.description);
			for (let argument of command.conf.args) { 
				if (argument[0] == 'string') {
					slashCommand.addStringOption(option =>
						option.setName(argument[1])
								.setDescription(argument[2])
								.setRequired(true));
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
