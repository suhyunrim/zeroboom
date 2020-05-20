const matchController = require('../controller/match');

exports.run = async (message, args) => {
	const result = await matchController.generateMatch('휘핑크림', [], [], args);
	return JSON.stringify(result);
}

exports.conf = {
	enabled: true,
	aliases: ['매칭생성', '자동매칭', 'mm'],
};

exports.help = {
	name: 'match-make',
	description: 'rating-based auto matching.',
	usage: '/match-make [command]'
};
