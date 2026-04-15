const models = require('../db/models');
const seasonController = require('../controller/season');

exports.run = async (groupName, interaction) => {
  const group = await models.group.findOne({ where: { discordGuildId: interaction.guildId } });
  if (!group) return '그룹을 찾을 수 없습니다.';

  const user = await models.user.findOne({
    where: { groupId: group.id, discordId: interaction.user.id },
  });
  if (!user || user.role !== 'admin') {
    return '관리자만 시즌 초기화를 할 수 있습니다.';
  }

  try {
    const result = await seasonController.resetSeason(
      group.id,
      interaction.user.id,
      interaction.member.nickname || interaction.user.username,
    );
    return `시즌 ${result.fromSeason} 종료! 시즌 ${result.toSeason} 시작. (${result.usersAffected}명 레이팅 소프트 리셋 완료)`;
  } catch (err) {
    return '시즌 초기화 중 오류가 발생했습니다.';
  }
};

exports.conf = {
  enabled: true,
  aliases: ['시즌초기화'],
  args: [],
};

exports.help = {
  name: '시즌초기화',
  description: '현재 시즌을 종료하고 새 시즌을 시작합니다 (관리자 전용)',
  usage: '시즌초기화',
};
