const reqEvent = (event) => require(`../discord/events/${event}`);
const Discord = require('discord.js');

module.exports = (app) => {
	const client  = new Discord.Client();

	client.on('ready', () => reqEvent('ready')(client));
	client.on('message', async message => reqEvent('message')(app, message));

	client.login(process.env.BOT_TOKEN);
}
