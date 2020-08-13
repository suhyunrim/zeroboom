const { registerUser } = require('../services/user');

exports.run = async ({ message, groupName, args }) => {
  args = args.join(' ');
  args = args.split('@');

  if (args.length != 2) {
    return 'invalid args';
  }

  const summonerName = args[0];
  const tier = args[1];
  const tokenId = process.env.RIOT_TOKEN_ID;

  const ret = await registerUser(groupName, summonerName, tier, tokenId);
  return ret.result;
};

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['유저등록', 'ru'],
};

exports.help = {
  name: 'register-user',
  description: 'register user.',
  usage: 'register-user summonerName@tier',
};
