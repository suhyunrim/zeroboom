const { registerUser } = require('../services/user');

exports.run = async (message, args) => {
	if(args.length != 3)
	{
		return 'invalid args';	
	}
	var summonerName = args[0];
	var tier = args[1];
	var tokenId = args[2];

	var ret = await registerUser('휘핑크림', summonerName, tier, tokenId);
	return ret.result; 
}

exports.conf = {
	enabled: true,
	aliases: ['유저등록', 'ru'],
};

exports.help = {
	name: 'register-user',
	description: 'register user.',
	usage: 'register-user groupName summonerName tier'
};
