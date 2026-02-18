const { Op } = require('sequelize');
const models = require('../db/models');

// 명예 칭호 (내림차순, minVotes = 실제 투표 수 * 5)
const HONOR_TITLES = [
  // 41~50: 전설/밈급
  { minVotes: 250, title: '아우렐리온 솔 그자체', emoji: '🌠' },
  { minVotes: 245, title: '우주급 캐리', emoji: '🪐' },
  { minVotes: 240, title: '신의 영역', emoji: '👼' },
  { minVotes: 235, title: '룬테라급 존재감', emoji: '🌍' },
  { minVotes: 230, title: '★ 체력 10만 초가스', emoji: '🫧' },
  { minVotes: 225, title: '★ 무기를 든 잭스', emoji: '🏮' },
  { minVotes: 220, title: '넥서스 수호신', emoji: '🛡️' },
  { minVotes: 215, title: '패치노트급 캐리', emoji: '📋' },
  { minVotes: 210, title: '게임 종결자', emoji: '🔚' },
  { minVotes: 205, title: '협곡의 재앙', emoji: '☄️' },
  // 31~40: 하드캐리/지휘
  { minVotes: 200, title: '1대9도 이김', emoji: '💀' },
  { minVotes: 195, title: '승리의 설계자', emoji: '📐' },
  { minVotes: 190, title: '한타 지휘관', emoji: '🎖️' },
  { minVotes: 185, title: '역전 제조기', emoji: '🔄' },
  { minVotes: 180, title: '용 스틸 장인', emoji: '🐲' },
  { minVotes: 175, title: '바론 콜 장인', emoji: '🐛' },
  { minVotes: 170, title: '한타 파괴자', emoji: '💣' },
  { minVotes: 165, title: '펜타킬 수집가', emoji: '🖐️' },
  { minVotes: 160, title: '쿼드킬 단골', emoji: '✋' },
  { minVotes: 155, title: '하이라이트 제조기', emoji: '🎬' },
  // 21~30: 캐리 가동
  { minVotes: 150, title: '캐리 머신', emoji: '⚙️' },
  { minVotes: 145, title: '백도어 협박자', emoji: '🚪' },
  { minVotes: 140, title: '억제기 분쇄자', emoji: '💥' },
  { minVotes: 135, title: '한타 피니셔', emoji: '🎯' },
  { minVotes: 130, title: '한타 첫 타격수', emoji: '🥊' },
  { minVotes: 125, title: '오브젝트 마무리꾼', emoji: '🐉' },
  { minVotes: 120, title: '트리플킬 장인', emoji: '🔱' },
  { minVotes: 115, title: '리셋각 노리는 자', emoji: '♻️' },
  { minVotes: 110, title: '솔킬 단골', emoji: '🗡️' },
  { minVotes: 105, title: '딜량 제조기', emoji: '📊' },
  // 11~20: 기본기 장착
  { minVotes: 100, title: '에이스 등판', emoji: '🃏' },
  { minVotes: 95, title: '스펠쿨 계산기', emoji: '🧮' },
  { minVotes: 90, title: '다이브 선봉장', emoji: '🪂' },
  { minVotes: 85, title: '점멸 킬각러', emoji: '⚡' },
  { minVotes: 80, title: '포지셔닝 장착', emoji: '📍' },
  { minVotes: 75, title: '카이팅 연습러', emoji: '🏃' },
  { minVotes: 70, title: '스킬샷 저격수', emoji: '🎯' },
  { minVotes: 65, title: '킬각 판독기', emoji: '🔍' },
  { minVotes: 60, title: '딜교환 맛집', emoji: '🍽️' },
  { minVotes: 55, title: '라인전 우세러', emoji: '📈' },
  // 1~10: 입문/신흥
  { minVotes: 50, title: '신흥 강자', emoji: '🔥' },
  { minVotes: 45, title: '첫 하이라이트', emoji: '🌟' },
  { minVotes: 40, title: '스노우볼 시동러', emoji: '❄️' },
  { minVotes: 35, title: '더블킬 꿈나무', emoji: '🌱' },
  { minVotes: 30, title: '라인전 연습생', emoji: '📝' },
  { minVotes: 25, title: '딜각 수습생', emoji: '🔰' },
  { minVotes: 20, title: '킬각 탐색자', emoji: '👀' },
  { minVotes: 15, title: '주목받는 신예', emoji: '✨' },
  { minVotes: 10, title: '견습 캐리', emoji: '🎓' },
  { minVotes: 5, title: '협곡 새내기', emoji: '🐣' },
];

const getHonorTitle = (totalVotes) => {
  const tier = HONOR_TITLES.find((t) => totalVotes >= t.minVotes);
  return tier || null;
};

module.exports.castVote = async (gameId, groupId, voterPuuid, targetPuuid, teamNumber) => {
  const existing = await models.honor_vote.findOne({
    where: { gameId, voterPuuid },
  });
  if (existing) {
    return { result: '이미 투표하셨습니다.', status: 400 };
  }

  await models.honor_vote.create({
    gameId,
    groupId,
    voterPuuid,
    targetPuuid,
    teamNumber,
  });

  return { result: '투표가 완료되었습니다.', status: 200 };
};

module.exports.getVoteResults = async (gameId) => {
  const votes = await models.honor_vote.findAll({
    where: { gameId },
    raw: true,
  });

  const counts = {};
  votes.forEach((vote) => {
    const key = `${vote.targetPuuid}|${vote.teamNumber}`;
    if (!counts[key]) {
      counts[key] = { targetPuuid: vote.targetPuuid, teamNumber: vote.teamNumber, votes: 0 };
    }
    counts[key].votes += 1;
  });

  return Object.values(counts);
};

module.exports.getHonorRanking = async (groupId, options = {}) => {
  const where = { groupId };
  if (options.since) {
    where.createdAt = { [Op.gte]: options.since };
  }

  const votes = await models.honor_vote.findAll({
    where,
    raw: true,
  });

  const received = {};
  const given = {};
  votes.forEach((vote) => {
    received[vote.targetPuuid] = (received[vote.targetPuuid] || 0) + 1;
    given[vote.voterPuuid] = (given[vote.voterPuuid] || 0) + 1;
  });

  // 받은 투표가 1표 이상인 유저만 랭킹에 포함
  const ranking = Object.keys(received)
    .map((puuid) => ({
      puuid,
      totalVotes: received[puuid],
      givenVotes: given[puuid] || 0,
    }))
    .sort((a, b) => b.totalVotes - a.totalVotes);

  ranking.forEach((entry) => {
    entry.title = getHonorTitle(entry.totalVotes);
  });

  const limit = options.limit || 20;
  return ranking.slice(0, limit);
};

module.exports.getHonorStats = async (groupId, puuid, options = {}) => {
  const where = { groupId };
  if (options.since) {
    where.createdAt = { [Op.gte]: options.since };
  }

  const received = await models.honor_vote.count({
    where: { ...where, targetPuuid: puuid },
  });

  const given = await models.honor_vote.count({
    where: { ...where, voterPuuid: puuid },
  });

  return {
    received,
    given,
    title: getHonorTitle(received),
  };
};

/**
 * 전원 투표 보너스: 참가자 전원에게 +1표 (자기 자신에게 투표)
 */
module.exports.grantFullVoteBonus = async (gameId, groupId, allPlayers) => {
  const bonusRecords = allPlayers.map((p) => ({
    gameId,
    groupId,
    voterPuuid: 'SYSTEM_BONUS',
    targetPuuid: p.puuid,
    teamNumber: 0,
  }));
  await models.honor_vote.bulkCreate(bonusRecords);
  return bonusRecords.length;
};

module.exports.deleteVotesByGameId = async (gameId) => {
  await models.honor_vote.destroy({
    where: { gameId },
  });
};

module.exports.HONOR_TITLES = HONOR_TITLES;
module.exports.getHonorTitle = getHonorTitle;
