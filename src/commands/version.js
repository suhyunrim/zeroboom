var fs = require('fs');

exports.run = async (message, args) => {
	var ret = "";
	await fs.readFile('/version_info.txt', 'uft8', function(err, data) {
		ret += data;
	});
	return ret;
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
