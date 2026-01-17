const matchMake = require('./match-make');
const models = require('../db/models');
const utils = require('../utils/pick-users-utils');

const {
  PICK_COUNT,
  MAX_TOGGLE_MEMBERS,
  getMemberInfo,
  buildToggleButtons,
  buildToggleMessage,
  handleToggle,
  executePick,
  buildPositionUI,
  buildUserEditUI,
  createReactButtonHandler,
} = utils;

exports.run = async (groupName, interaction) => {
  if (!interaction.member.voice.channelId) {
    return '입장해있는 음성채널이 없습니다.';
  }

  const members = interaction.member.voice.channel.members;
  const channelName = interaction.member.voice.channel.name;

  if (members.size < PICK_COUNT) {
    return `채널에 ${members.size}명이 있습니다. 최소 ${PICK_COUNT}명이 필요합니다.`;
  }

  if (members.size > MAX_TOGGLE_MEMBERS) {
    return `채널에 ${members.size}명이 있습니다. 토글 UI는 최대 ${MAX_TOGGLE_MEMBERS}명까지 지원합니다.`;
  }

  const memberList = [];
  for (const [, member] of members) {
    memberList.push(getMemberInfo(member));
  }

  const time = Date.now();
  const rows = buildToggleButtons(memberList, [], time);
  const includedCount = memberList.length;

  return {
    content: buildToggleMessage(channelName, memberList.length, includedCount),
    components: rows,
    fetchReply: true,
    isToggleMode: true,
    memberList,
    excludedNames: [],
    groupName,
    channelName,
  };
};

exports.handleToggle = handleToggle;
exports.executePick = executePick;
exports.buildPositionUI = buildPositionUI;
exports.buildUserEditUI = buildUserEditUI;

exports.reactButton = createReactButtonHandler(matchMake, models, buildPositionUI);

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['인원뽑기'],
  args: [],
};

exports.help = {
  name: 'pick-users',
  description: '제외할 인원을 선택 후 10명 뽑기',
  usage: 'pick-users',
};
