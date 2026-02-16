const { Op } = require('sequelize');
const models = require('../db/models');

const HONOR_TITLES = [
  { minVotes: 100, title: '팀의 빛', emoji: '🌟' },
  { minVotes: 50, title: '존경받는 자', emoji: '👑' },
  { minVotes: 25, title: '든든한 팀원', emoji: '🛡️' },
  { minVotes: 10, title: '유망주', emoji: '⭐' },
  { minVotes: 1, title: '인정받는 자', emoji: '🤝' },
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

  const counts = {};
  votes.forEach((vote) => {
    if (!counts[vote.targetPuuid]) {
      counts[vote.targetPuuid] = 0;
    }
    counts[vote.targetPuuid] += 1;
  });

  const ranking = Object.entries(counts)
    .map(([puuid, totalVotes]) => ({
      puuid,
      totalVotes,
      title: getHonorTitle(totalVotes),
    }))
    .sort((a, b) => b.totalVotes - a.totalVotes);

  const limit = options.limit || 20;
  return ranking.slice(0, limit);
};

module.exports.getHonorStats = async (groupId, puuid) => {
  const received = await models.honor_vote.count({
    where: { groupId, targetPuuid: puuid },
  });

  const given = await models.honor_vote.count({
    where: { groupId, voterPuuid: puuid },
  });

  return {
    received,
    given,
    title: getHonorTitle(received),
  };
};

module.exports.deleteVotesByGameId = async (gameId) => {
  await models.honor_vote.destroy({
    where: { gameId },
  });
};

module.exports.getHonorTitle = getHonorTitle;
