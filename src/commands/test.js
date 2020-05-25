const { getSummonerByName } = require('../services/riot-api');

exports.run = async (message, args) => {
	var name = args.join(" ");
	var ret = await getSummonerByName(name);
	return JSON.stringify(ret); 
}

exports.conf = {
	enabled: true,
	aliases: ['테스트'],
};

exports.help = {
	name: 'test',
	description: '기능테스트 디버그용.',
	usage: 'test [args]'
};
