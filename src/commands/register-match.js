const controller = require('../controller/match');

exports.run = async (message, args) => {
	if(args.length != 2) {
		return "invalid args";
	}
	var summonerName = args[0];
	var tokenId = args[1];

	var ret = await controller.registerMatch(tokenId, summonerName);
	return ret.result;
}

exports.conf = {
	enabled: true,
	aliases: ['대전등록', 'rm'],
};

exports.help = {
	name: 'register-match',
	description: 'register match.',
	usage: 'register-match summonerName tokenId'
};
