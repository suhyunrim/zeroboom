const models = require('../db/models');
const { startOnboarding } = require('../discord/onboarding');

exports.run = async (groupName, interaction) => {
  const group = await models.group.findOne({ where: { groupName } });
  if (!group) return '그룹을 찾을 수 없습니다.';

  const member = interaction.member;
  await startOnboarding(member, group, { testMode: true });
  return '온보딩 테스트 DM을 전송했습니다. DM을 확인해주세요.';
};

exports.conf = {
  enabled: !!process.env.COMMAND_PREFIX,
  requireGroup: true,
  aliases: ['온보딩테스트'],
  args: [],
};

exports.help = {
  name: 'test-onboarding',
  description: '온보딩 DM 플로우 테스트 (DB 저장 없음)',
  usage: 'test-onboarding',
};
