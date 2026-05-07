const { Op } = require('sequelize');
const elo = require('arpad');
const models = require('../db/models');
const { incrementStat } = require('../services/achievement/stats');
const { STAT_TYPES } = require('../services/achievement/definitions');
const { processAchievements } = require('../services/achievement/engine');
const { logger } = require('../loaders/logger');

const TEAM_SIZE = 5;
const VALID_POSITIONS = ['top', 'jungle', 'mid', 'adc', 'support'];

const STATUS = {
  PREPARING: 'preparing',
  IN_PROGRESS: 'in_progress',
  FINISHED: 'finished',
};

const TROPHY_TYPES = ['worlds', 'msi', 'first_stand', 'ewc', 'lck', 'kespa'];

const validateTrophyType = (trophyType) => {
  if (trophyType === null || trophyType === undefined) return null;
  if (typeof trophyType !== 'string' || !TROPHY_TYPES.includes(trophyType)) {
    return `trophyType은 다음 중 하나여야 합니다: ${TROPHY_TYPES.join(', ')}`;
  }
  return null;
};

const ratingCalculator = new elo(16);

const computeBracketSize = (teamCount) => {
  if (teamCount < 2) return 2;
  return 2 ** Math.ceil(Math.log2(teamCount));
};

const getWinningScore = (bestOf) => Math.ceil(bestOf / 2);

const computeRoundLabels = (bracketSize, teamCount) => {
  if (!bracketSize) return {};
  const totalRounds = Math.log2(bracketSize);
  const labels = {};
  for (let r = 1; r <= totalRounds; r += 1) {
    const teamsInRound = bracketSize / 2 ** (r - 1);
    labels[r] = teamsInRound === 2 ? '결승' : `${teamsInRound}강`;
  }
  if (teamCount < bracketSize) {
    labels[1] = '예선';
  }
  return labels;
};

const getNextMatchPosition = (round, slot) => ({
  round: round + 1,
  slot: Math.floor(slot / 2),
  side: slot % 2 === 0 ? 'team1' : 'team2',
});

const validateScore = (bestOf, team1Score, team2Score) => {
  if (!Number.isInteger(team1Score) || !Number.isInteger(team2Score)) return false;
  if (team1Score < 0 || team2Score < 0) return false;
  if (team1Score === team2Score) return false;
  const winning = getWinningScore(bestOf);
  const max = Math.max(team1Score, team2Score);
  const min = Math.min(team1Score, team2Score);
  if (max !== winning) return false;
  if (min >= winning) return false;
  if (max + min > bestOf) return false;
  return true;
};

const validateTeamInput = ({ name, captainPuuid, members }) => {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return '팀명이 필요합니다.';
  }
  if (!Array.isArray(members) || members.length !== TEAM_SIZE) {
    return `팀원은 ${TEAM_SIZE}명이어야 합니다.`;
  }
  const puuidSet = new Set();
  for (const m of members) {
    if (!m || typeof m.puuid !== 'string' || !m.puuid) return '팀원의 puuid가 필요합니다.';
    if (!VALID_POSITIONS.includes(m.position)) return '유효하지 않은 포지션입니다.';
    if (puuidSet.has(m.puuid)) return '같은 팀에 동일 인물이 중복되어 있습니다.';
    puuidSet.add(m.puuid);
  }
  if (!captainPuuid || !puuidSet.has(captainPuuid)) {
    return '팀장은 팀원 중 한 명이어야 합니다.';
  }
  return null;
};

const validateScrimInput = ({ team1Id, team2Id, team1Score, team2Score }, teams) => {  if (!Number.isInteger(team1Id) || !Number.isInteger(team2Id)) {
    return 'team1Id, team2Id가 필요합니다.';
  }
  if (team1Id === team2Id) {
    return '같은 팀끼리 스크림을 할 수 없습니다.';
  }
  if (!Number.isInteger(team1Score) || !Number.isInteger(team2Score)) {
    return '점수는 정수여야 합니다.';
  }
  if (team1Score < 0 || team2Score < 0) {
    return '점수는 0 이상이어야 합니다.';
  }
  const teamIdSet = new Set(teams.map((t) => t.id));
  if (!teamIdSet.has(team1Id) || !teamIdSet.has(team2Id)) {
    return '두 팀 모두 이 토너먼트의 팀이어야 합니다.';
  }
  return null;
};

const computeTeamScrimRecord = (teamId, scrims) => {
  let won = 0;
  let lost = 0;
  let played = 0;
  scrims.forEach((s) => {
    if (s.team1Id === teamId) {
      won += s.team1Score;
      lost += s.team2Score;
      played += 1;
    } else if (s.team2Id === teamId) {
      won += s.team2Score;
      lost += s.team1Score;
      played += 1;
    }
  });
  return { won, lost, played };
};

const computeHeadToHeadScrim = (team1Id, team2Id, scrims) => {
  let t1Won = 0;
  let t1Lost = 0;
  let played = 0;
  scrims.forEach((s) => {
    if (s.team1Id === team1Id && s.team2Id === team2Id) {
      t1Won += s.team1Score;
      t1Lost += s.team2Score;
      played += 1;
    } else if (s.team1Id === team2Id && s.team2Id === team1Id) {
      t1Won += s.team2Score;
      t1Lost += s.team1Score;
      played += 1;
    }
  });
  return {
    team1: { won: t1Won, lost: t1Lost },
    team2: { won: t1Lost, lost: t1Won },
    played,
  };
};

const validateSlotMapping = (slotMapping, teams, bracketSize, teamCount) => {
  if (!Array.isArray(slotMapping) || slotMapping.length !== bracketSize) {
    return `slotMapping은 길이 ${bracketSize}의 배열이어야 합니다.`;
  }
  const placedIds = slotMapping.filter((v) => v !== null && v !== undefined);
  if (placedIds.length !== teamCount) {
    return `정확히 ${teamCount}개의 팀을 배치해야 합니다.`;
  }
  if (new Set(placedIds).size !== placedIds.length) {
    return '같은 팀이 여러 슬롯에 배치되었습니다.';
  }
  const teamIdSet = new Set(teams.map((t) => t.id));
  if (!placedIds.every((tid) => teamIdSet.has(tid))) {
    return '존재하지 않는 팀이 슬롯에 포함되어 있습니다.';
  }
  for (let i = 0; i < bracketSize; i += 2) {
    if (!slotMapping[i] && !slotMapping[i + 1]) {
      return '한 매치에 두 BYE가 들어갈 수 없습니다.';
    }
  }
  return null;
};

const computeWinProbability = (ratingA, ratingB) => {
  if (ratingA == null || ratingB == null) return null;
  return ratingCalculator.expectedScore(ratingA, ratingB);
};

const computeTeamAvgRating = (members, ratingByPuuid) => {
  const ratings = members.map((m) => ratingByPuuid[m.puuid]).filter((r) => r != null);
  if (ratings.length === 0) return null;
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
};

const verifyMembersInGroup = async (groupId, puuids) => {
  const rows = await models.user.findAll({
    where: { groupId, puuid: puuids },
    attributes: ['puuid'],
  });
  return rows.length === puuids.length;
};

const findDuplicatePuuids = async (tournamentId, puuids, excludeTeamId = null) => {
  const where = { tournamentId };
  if (excludeTeamId) where.id = { [Op.ne]: excludeTeamId };
  const teams = await models.tournament_team.findAll({ where });
  const existing = new Set();
  teams.forEach((t) => {
    (t.members || []).forEach((m) => existing.add(m.puuid));
  });
  return puuids.filter((p) => existing.has(p));
};

const generateMatchRows = (tournamentId, bracketSize, defaultBestOf, finalBestOf) => {
  const totalRounds = Math.log2(bracketSize);
  const rows = [];
  for (let round = 1; round <= totalRounds; round += 1) {
    const matchCount = bracketSize / 2 ** round;
    const bestOf = round === totalRounds ? finalBestOf : defaultBestOf;
    for (let slot = 0; slot < matchCount; slot += 1) {
      rows.push({
        tournamentId,
        round,
        bracketSlot: slot,
        team1Id: null,
        team2Id: null,
        team1Score: 0,
        team2Score: 0,
        winnerTeamId: null,
        bestOf,
      });
    }
  }
  return rows;
};

// BYE 매치가 다음 라운드의 같은 매치로 진출하는 경우(인접 슬롯이 둘 다 BYE)를
// 동시 write로 race 시키지 않으려고 sequential하게 처리한다. 슬롯 매핑 단계에서
// 한 매치에 두 BYE가 들어가지 않도록 검증하지만, 안전망으로 직렬 진행을 유지.
const placeTeamsAndResolveByes = async (tournament, slotMapping, options = {}) => {
  const r1Matches = await models.tournament_match.findAll({
    where: { tournamentId: tournament.id, round: 1 },
    order: [['bracketSlot', 'ASC']],
    transaction: options.transaction,
  });

  for (const match of r1Matches) {
    const team1Id = slotMapping[match.bracketSlot * 2] || null;
    const team2Id = slotMapping[match.bracketSlot * 2 + 1] || null;
    match.team1Id = team1Id;
    match.team2Id = team2Id;

    if ((team1Id && !team2Id) || (!team1Id && team2Id)) {
      const winnerTeamId = team1Id || team2Id;
      match.winnerTeamId = winnerTeamId;
      await match.save({ transaction: options.transaction });
      await propagateWinner(tournament, match.round, match.bracketSlot, winnerTeamId, options);
    } else {
      await match.save({ transaction: options.transaction });
    }
  }
};

const propagateWinner = async (tournament, round, slot, winnerTeamId, options = {}) => {
  const totalRounds = Math.log2(tournament.bracketSize);
  if (round === totalRounds) {
    tournament.championTeamId = winnerTeamId;
    tournament.status = STATUS.FINISHED;
    await tournament.save({ transaction: options.transaction });
    return;
  }

  const next = getNextMatchPosition(round, slot);
  const nextMatch = await models.tournament_match.findOne({
    where: { tournamentId: tournament.id, round: next.round, bracketSlot: next.slot },
    transaction: options.transaction,
  });
  if (!nextMatch) return;

  if (next.side === 'team1') nextMatch.team1Id = winnerTeamId;
  else nextMatch.team2Id = winnerTeamId;

  await nextMatch.save({ transaction: options.transaction });
};

const recordMatchResult = async (match, team1Score, team2Score, options = {}) => {
  if (!match.team1Id || !match.team2Id) {
    return { ok: false, error: '두 팀이 모두 배정되어야 결과를 입력할 수 있습니다.' };
  }
  if (match.winnerTeamId) {
    return { ok: false, error: '이미 결과가 기록된 매치입니다.' };
  }
  if (!validateScore(match.bestOf, team1Score, team2Score)) {
    return { ok: false, error: '유효하지 않은 점수입니다.' };
  }

  const winnerTeamId = team1Score > team2Score ? match.team1Id : match.team2Id;
  match.team1Score = team1Score;
  match.team2Score = team2Score;
  match.winnerTeamId = winnerTeamId;
  await match.save({ transaction: options.transaction });

  const tournament = await models.tournament.findByPk(match.tournamentId, {
    transaction: options.transaction,
  });
  await propagateWinner(tournament, match.round, match.bracketSlot, winnerTeamId, options);

  return { ok: true, match, tournament };
};

const findPerfectPredictors = (matches, predictions) => {
  // BYE 매치(한쪽 슬롯이 null)는 자동 처리되어 정답 의미가 없으므로 제외.
  const validMatches = matches.filter(
    (m) => m.team1Id != null && m.team2Id != null && m.winnerTeamId != null,
  );
  if (validMatches.length === 0) return [];
  const winnerByMatchId = new Map(validMatches.map((m) => [m.id, m.winnerTeamId]));

  const correctByUser = new Map();
  for (const p of predictions) {
    const winner = winnerByMatchId.get(p.matchId);
    if (winner == null) continue;
    if (p.predictedTeamId !== winner) continue;
    correctByUser.set(p.userPuuid, (correctByUser.get(p.userPuuid) || 0) + 1);
  }

  const perfectPuuids = [];
  for (const [puuid, count] of correctByUser) {
    if (count === validMatches.length) perfectPuuids.push(puuid);
  }
  return perfectPuuids;
};

const handleTournamentFinishedAchievements = async (tournament) => {
  try {
    const [matches, predictionsRaw] = await Promise.all([
      models.tournament_match.findAll({ where: { tournamentId: tournament.id } }),
      models.tournament_match_prediction.findAll({
        include: [{
          model: models.tournament_match,
          where: { tournamentId: tournament.id },
          attributes: [],
          required: true,
        }],
      }),
    ]);
    const predictions = predictionsRaw.map((p) => ({
      matchId: p.matchId,
      userPuuid: p.userPuuid,
      predictedTeamId: p.predictedTeamId,
    }));
    const perfectPuuids = findPerfectPredictors(matches, predictions);
    if (perfectPuuids.length === 0) return [];

    await Promise.all(perfectPuuids.map((puuid) => incrementStat(
      puuid,
      tournament.groupId,
      STAT_TYPES.PREDICTION_PERFECT_COUNT,
    )));

    const users = await models.user.findAll({
      where: { groupId: tournament.groupId, puuid: perfectPuuids },
      raw: true,
    });
    const userMap = {};
    users.forEach((u) => { userMap[u.puuid] = u; });
    return await processAchievements('tournament_end', { groupId: tournament.groupId, userMap });
  } catch (e) {
    logger.error('토너먼트 종료 업적 처리 실패:', e);
    return [];
  }
};

const isTournamentLocked = (matches, now = new Date()) => {
  // BYE/미정 매치(한쪽 또는 양쪽 슬롯이 null)는 winnerTeamId가 자동 설정되거나
  // 다음 라운드 placeholder라서 "매치 시작됨" 판정에서 제외한다.
  return matches.some((m) => {
    if (m.team1Id == null || m.team2Id == null) return false;
    if (m.team1Score > 0 || m.team2Score > 0 || m.winnerTeamId != null) return true;
    if (m.scheduledAt && new Date(m.scheduledAt) <= now) return true;
    return false;
  });
};

const validatePredictionsInput = ({ predictions, matches, teams, existingPredictions = [] }) => {
  if (!Array.isArray(predictions)) return 'predictions는 배열이어야 합니다.';
  const matchIds = new Set(matches.map((m) => m.id));
  const teamIds = new Set(teams.map((t) => t.id));
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const seenMatchIds = new Set();
  for (const p of predictions) {
    if (!p || !Number.isInteger(p.matchId)) return '각 예측에 matchId가 필요합니다.';
    if (!matchIds.has(p.matchId)) return '이 토너먼트에 속하지 않은 매치입니다.';
    if (seenMatchIds.has(p.matchId)) return '같은 매치에 중복된 예측이 있습니다.';
    seenMatchIds.add(p.matchId);
    if (p.predictedTeamId !== null) {
      if (!Number.isInteger(p.predictedTeamId)) return 'predictedTeamId는 정수 또는 null이어야 합니다.';
      if (!teamIds.has(p.predictedTeamId)) return '이 토너먼트에 속하지 않은 팀입니다.';
      const match = matchById.get(p.matchId);
      if (match.team1Id != null && match.team2Id != null) {
        if (p.predictedTeamId !== match.team1Id && p.predictedTeamId !== match.team2Id) {
          return '두 팀이 정해진 매치에서는 그중 한 팀만 선택할 수 있습니다.';
        }
      }
    }
  }

  // BYE(한쪽 슬롯만 채워진 매치)를 제외한 모든 매치에 예측이 있어야 한다.
  // existingPredictions(DB의 본인 기존 예측) + 이번 변경분을 합친 최종 상태 기준으로 검증.
  const isBye = (m) => (m.team1Id != null) !== (m.team2Id != null);
  const requiredMatchIds = matches.filter((m) => !isBye(m)).map((m) => m.id);
  const finalSet = new Set(existingPredictions.map((p) => p.matchId));
  for (const p of predictions) {
    if (p.predictedTeamId === null) finalSet.delete(p.matchId);
    else finalSet.add(p.matchId);
  }
  for (const mid of requiredMatchIds) {
    if (!finalSet.has(mid)) return 'BYE를 제외한 모든 매치에 예측이 필요합니다.';
  }

  return null;
};

const applyPredictions = async ({ userPuuid, predictions, transaction }) => {
  const toDelete = predictions.filter((p) => p.predictedTeamId === null).map((p) => p.matchId);
  const toUpsert = predictions
    .filter((p) => p.predictedTeamId !== null)
    .map((p) => ({ matchId: p.matchId, userPuuid, predictedTeamId: p.predictedTeamId }));

  if (toDelete.length > 0) {
    await models.tournament_match_prediction.destroy({
      where: { matchId: toDelete, userPuuid },
      transaction,
    });
  }
  if (toUpsert.length > 0) {
    await models.tournament_match_prediction.bulkCreate(toUpsert, {
      updateOnDuplicate: ['predictedTeamId', 'updatedAt'],
      transaction,
    });
  }
  return { deleted: toDelete.length, upserted: toUpsert.length };
};

const enrichMatchesWithPredictions = (matches, predictions) => {
  const byMatch = new Map();
  for (const p of predictions) {
    if (!byMatch.has(p.matchId)) byMatch.set(p.matchId, []);
    byMatch.get(p.matchId).push(p);
  }
  return matches.map((m) => {
    const data = m.toJSON ? m.toJSON() : { ...m };
    const list = byMatch.get(data.id) || [];
    let c1 = 0;
    let c2 = 0;
    for (const p of list) {
      if (p.predictedTeamId === data.team1Id) c1 += 1;
      else if (p.predictedTeamId === data.team2Id) c2 += 1;
    }
    const total = c1 + c2;
    data.predictions = list.map((p) => ({
      userPuuid: p.userPuuid,
      summonerName: p.summonerName || null,
      predictedTeamId: p.predictedTeamId,
      updatedAt: p.updatedAt,
    }));
    data.team1PredictionCount = c1;
    data.team2PredictionCount = c2;
    data.team1PredictionPct = total > 0 ? c1 / total : null;
    data.team2PredictionPct = total > 0 ? c2 / total : null;
    return data;
  });
};

const buildLeaderboard = (matches, predictions) => {
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const byUser = new Map();
  for (const p of predictions) {
    const match = matchById.get(p.matchId);
    if (match && match.winnerTeamId != null) {
      if (!byUser.has(p.userPuuid)) {
        byUser.set(p.userPuuid, {
          userPuuid: p.userPuuid,
          summonerName: p.summonerName || null,
          correctCount: 0,
          settledCount: 0,
        });
      }
      const entry = byUser.get(p.userPuuid);
      entry.settledCount += 1;
      if (p.predictedTeamId === match.winnerTeamId) entry.correctCount += 1;
    }
  }
  return [...byUser.values()].sort((a, b) => {
    if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
    return a.settledCount - b.settledCount;
  });
};

module.exports = {
  TEAM_SIZE,
  VALID_POSITIONS,
  STATUS,
  TROPHY_TYPES,
  validateTrophyType,
  computeBracketSize,
  getWinningScore,
  computeRoundLabels,
  getNextMatchPosition,
  validateScore,
  validateTeamInput,
  validateSlotMapping,
  validateScrimInput,
  verifyMembersInGroup,
  findDuplicatePuuids,
  generateMatchRows,
  placeTeamsAndResolveByes,
  propagateWinner,
  recordMatchResult,
  computeWinProbability,
  computeTeamAvgRating,
  computeTeamScrimRecord,
  computeHeadToHeadScrim,
  isTournamentLocked,
  validatePredictionsInput,
  applyPredictions,
  enrichMatchesWithPredictions,
  buildLeaderboard,
  findPerfectPredictors,
  handleTournamentFinishedAchievements,
};
