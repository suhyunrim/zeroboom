const { logger } = require('./logger');
const fs = require('fs');

module.exports = app => {
	app.commands = new Map();
	app.aliases = new Map();

	fs.readdir('./src/commands/', (err, files) => {
		if (err) logger.error(err);
		logger.info(`Loading a total of ${files.length} commands.`);
		files.forEach(f => {
			let props = require(`../commands/${f}`);
			logger.info(`Command Loaded! ${props.help.name} 👌`);
			app.commands.set(props.help.name, props);
			props.conf.aliases.forEach(alias => {
				app.aliases.set(alias, props.help.name);
			});
		});
	});
}
