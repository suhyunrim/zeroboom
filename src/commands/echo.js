const fs = require('fs')
exports.run = (message, args) => {
	return args.join(" ");
}

exports.conf = {
	enabled: true,
	aliases: ['e', 'ech'],
};

exports.help = {
	name: 'echo',
	description: 'echo.',
	usage: 'echo [command]'
};
