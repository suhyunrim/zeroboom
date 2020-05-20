module.exports = async (app, message) => {
	if(message.author.bot) return;

	var prefix = '/';
	var client = message.client;

	if (!message.content.startsWith(prefix)) 
		return;  
    
	let command = message.content.split(' ')[0].slice(prefix.length);
	let params = message.content.split(' ').slice(1);
    
	let cmd;
	if (app.commands.has(command)) {
		cmd = app.commands.get(command);
	}
	else if (app.aliases.has(command)) {
		cmd = app.commands.get(app.aliases.get(command));
	}

	let output;
	if (cmd) {
		output = await cmd.run(message, params);
	}

	if(output)
	{
		message.channel.send(output);
	}
};
