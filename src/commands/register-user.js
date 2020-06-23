const { registerUser } = require('../services/user');

exports.run = async (message, args) => {
	args = args.join(" ");
	args = args.split("@");

	if(args.length != 2)
	{
		return 'invalid args';	
	}

	var summonerName = args[0];
	var tier = args[1];
	var tokenId = process.env.RIOT_TOKEN_ID; 

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
	usage: 'register-user summonerName@tier'
};
