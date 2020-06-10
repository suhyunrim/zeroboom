exports.run = async (message, args) => {
	var pjson = require('./package.json');
	return pjson.version;
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
