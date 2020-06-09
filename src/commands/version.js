exports.run = (message, args) => {
	return process.env.VERSION_INFO;
}

exports.conf = {
	enabled: true,
	aliases: ['v', '버전'],
};

exports.help = {
	name: 'version',
	description: 'version info',
	usage: 'version'
};
