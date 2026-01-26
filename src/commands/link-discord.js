const models = require('../db/models');

exports.run = async (groupName, interaction) => {
  const discordUser = interaction.options.getUser('디스코드유저');
  const summonerName = interaction.options.getString('롤닉네임');

  if (!discordUser) {
    return '디스코드 유저를 멘션해주세요.';
  }

  if (!summonerName) {
    return '롤 닉네임을 입력해주세요.';
  }

  const group = await models.group.findOne({
    where: { groupName },
  });

  if (!group) {
    return '그룹 정보를 찾을 수 없습니다.';
  }

  // 소환사 찾기 (simplifiedName으로 검색)
  const simplifiedName = summonerName.toLowerCase().replace(/ /g, '');
  const summoner = await models.summoner.findOne({
    where: { simplifiedName },
  });

  if (!summoner) {
    return `[${summonerName}] 소환사를 찾을 수 없습니다.`;
  }

  // 유저 찾기
  const user = await models.user.findOne({
    where: { groupId: group.id, puuid: summoner.puuid },
  });

  if (!user) {
    return `[${summonerName}]은(는) 그룹에 등록되지 않은 유저입니다.`;
  }

  // discordId 업데이트
  await user.update({ discordId: discordUser.id });

  return `[**${summonerName}**] ↔ <@${discordUser.id}> 연결 완료!`;
};

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['유저디코연결'],
  args: [
    ['user', '디스코드유저', '연결할 디스코드 유저를 멘션해주세요.', true],
    ['string', '롤닉네임', '롤 닉네임을 입력해주세요.', true],
  ],
};

exports.help = {
  name: 'link-discord',
  description: '기존 유저에 디스코드 계정 연결',
  usage: '/유저디코연결 @디스코드유저 롤닉네임',
};
