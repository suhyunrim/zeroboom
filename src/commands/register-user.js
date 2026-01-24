const { registerUser } = require('../services/user');

exports.run = async (groupName, interaction) => {
  const discordUser = interaction.options.getUser('디스코드유저');
  const summonerName = interaction.options.getString('닉네임');
  const tier = interaction.options.getString('티어');
  const discordId = discordUser ? discordUser.id : null;
  const ret = await registerUser(groupName, summonerName, tier, discordId);
  return ret.result;
};

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['유저등록', 'ru'],
  args: [
    ['user', '디스코드유저', '디스코드 유저를 멘션해주세요.', true],
    ['string', '롤닉네임', '롤 닉네임을 입력해주세요.', true],
    ['string', '티어', '티어를 입력해주세요. (ex. G1)', true],
  ],
};

exports.help = {
  name: 'register-user',
  description: 'register user.',
  usage: '/유저등록 @디스코드유저 롤닉네임 티어',
};
