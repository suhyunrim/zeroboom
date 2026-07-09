const { registerUser } = require('../services/user');
const auditLog = require('../controller/audit-log');
const { syncUserAdminRole } = require('../discord/adminSync');
const { logger } = require('../loaders/logger');

exports.run = async (groupName, interaction) => {
  const discordUser = interaction.options.getUser('디스코드유저');
  const summonerName = interaction.options.getString('롤닉네임');
  const tier = interaction.options.getString('티어');
  const discordId = discordUser ? discordUser.id : null;
  const ret = await registerUser(groupName, summonerName, tier, discordId);

  if (ret.status === 200) {
    auditLog.log({
      groupId: ret.group.id,
      actorDiscordId: interaction.user ? interaction.user.id : null,
      actorName: interaction.user
        ? interaction.user.globalName || interaction.user.username || null
        : null,
      action: 'user.register',
      details: { summonerName, tier, linkedDiscordId: discordId },
    });
  }

  // 디스코드 계정이 연결된 등록이면 권한(role)을 즉시 동기화한다.
  // (재시작/역할변경 이벤트를 기다리지 않고 admin 캐시가 어긋나지 않게)
  if (ret.status === 200 && discordUser && interaction.guild) {
    try {
      const member = await interaction.guild.members.fetch(discordUser.id);
      await syncUserAdminRole(member, ret.group);
    } catch (e) {
      logger.warn(`유저등록 권한 동기화 실패: ${e.message}`);
    }
  }

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
