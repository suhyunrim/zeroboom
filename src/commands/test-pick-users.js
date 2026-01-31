const matchMake = require('./match-make');
const models = require('../db/models');
const utils = require('../utils/pick-users-utils');

const {
  PICK_COUNT,
  buildToggleButtons,
  buildToggleMessage,
  handleToggle,
  executePick,
  buildPositionUI,
  createReactButtonHandler,
} = utils;

const TEST_MEMBER_COUNT = 15;

// 테스트 모드: 그룹에서 랜덤 15명 가져오기
const getTestMembers = async (groupName) => {
  const group = await models.group.findOne({
    where: { groupName },
  });

  if (!group) {
    return [];
  }

  const users = await models.user.findAll({
    where: { groupId: group.id },
  });

  if (users.length === 0) {
    return [];
  }

  const puuids = users.map((u) => u.puuid);
  const summoners = await models.summoner.findAll({
    where: { puuid: puuids },
  });

  // puuid -> discordId 매핑 생성
  const discordIdMap = {};
  users.forEach((u) => {
    discordIdMap[u.puuid] = u.discordId;
  });

  const memberList = summoners.map((s) => ({
    discordId: discordIdMap[s.puuid] || null,
    nickname: s.name,
    lolNickname: s.name,
  }));

  const shuffled = memberList.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, TEST_MEMBER_COUNT);
};

exports.run = async (groupName, interaction) => {
  const memberList = await getTestMembers(groupName);
  const channelName = '테스트 모드';

  if (memberList.length < PICK_COUNT) {
    return `그룹에 등록된 유저가 ${memberList.length}명입니다. 최소 ${PICK_COUNT}명이 필요합니다.`;
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
    excludedIds: [],
    groupName,
    channelName,
  };
};

exports.handleToggle = handleToggle;
exports.executePick = executePick;

exports.reactButton = createReactButtonHandler(matchMake, models, buildPositionUI);

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['테스트_인원뽑기'],
  args: [],
};

exports.help = {
  name: 'test-pick-users',
  description: '그룹에서 랜덤 15명으로 테스트 뽑기',
  usage: 'test-pick-users',
};
