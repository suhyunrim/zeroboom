const { registerUser } = require('../services/user');

exports.run = async (groupName, interaction) => {
  const summonerName = interaction.options.getString('롤닉네임');
  const tier = interaction.options.getString('티어');
  const ret = await registerUser(groupName, summonerName, tier, null, { asOutsider: true });
  return ret.result;
};

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['외부인등록'],
  args: [
    ['string', '롤닉네임', '롤 닉네임을 입력해주세요.', true],
    ['string', '티어', '티어를 입력해주세요. (ex. G1)', true],
  ],
};

exports.help = {
  name: 'register-outsider',
  description: '디스코드 계정 없이 외부인(롤 계정)을 outsider로 등록합니다.',
  usage: '/외부인등록 롤닉네임 티어',
};
