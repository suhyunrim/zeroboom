const { registerUser } = require('../services/user');

exports.run = async (groupName, interaction) => {
  const summonerName = interaction.options.data[0].value;
  const tier = interaction.options.data[1].value;
  const ret = await registerUser(groupName, summonerName, tier);
  return ret.result;
};

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['유저등록', 'ru'],
  args: [
    ['string', '닉네임', '닉네임을 입력해주세요.', true],
    ['string', '티어', '티어를 입력해주세요. (ex. G1)', true],
  ],
};

exports.help = {
  name: 'register-user',
  description: 'register user.',
  usage: 'register-user summonerName@tier',
};
