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
  AUCTION: 'auction',
  IN_PROGRESS: 'in_progress',
  FINISHED: 'finished',
};

const TYPES = {
  NORMAL: 'normal',
  AUCTION: 'auction',
};

// 승부예측 방식.
//  - BRACKET: 전체 대진을 미리 다 찍는 방식(기존). 완결성 강제 + 브래킷 트리 일관성.
//  - ROLLING: 양팀이 확정되고 아직 시작 안 한 매치만 순차로 찍는 방식. 완결성/트리 불필요.
const PREDICTION_MODES = {
  BRACKET: 'bracket',
  ROLLING: 'rolling',
};

const TROPHY_TYPES = ['worlds', 'msi', 'first_stand', 'ewc', 'lck', 'kespa'];

const validateTournamentType = (type) => {
  if (type === undefined || type === null) return null;
  if (!Object.values(TYPES).includes(type)) {
    return `type은 다음 중 하나여야 합니다: ${Object.values(TYPES).join(', ')}`;
  }
  return null;
};

const validatePredictionMode = (mode) => {
  if (mode === undefined || mode === null) return null;
  if (!Object.values(PREDICTION_MODES).includes(mode)) {
    return `predictionMode는 다음 중 하나여야 합니다: ${Object.values(PREDICTION_MODES).join(', ')}`;
  }
  return null;
};

const validateAuctionConfig = (config) => {
  if (config === null || config === undefined) return 'auction 타입은 auctionConfig가 필요합니다.';
  if (typeof config !== 'object' || Array.isArray(config)) return 'auctionConfig는 객체여야 합니다.';
  const { minBid, allowNegative, candidates, bidDurationSeconds } = config;
  if (!Number.isInteger(minBid) || minBid <= 0) return 'auctionConfig.minBid는 양의 정수여야 합니다.';
  if (!Number.isInteger(bidDurationSeconds) || bidDurationSeconds <= 0) {
    return 'auctionConfig.bidDurationSeconds는 양의 정수여야 합니다.';
  }
  if (allowNegative !== undefined && typeof allowNegative !== 'boolean') {
    return 'auctionConfig.allowNegative는 boolean이어야 합니다.';
  }
  if (!candidates || typeof candidates !== 'object' || Array.isArray(candidates)) {
    return 'auctionConfig.candidates 객체가 필요합니다.';
  }
  const seen = new Set();
  let countPerPosition = null;
  for (const pos of VALID_POSITIONS) {
    const list = candidates[pos];
    if (!Array.isArray(list)) return `auctionConfig.candidates.${pos} 배열이 필요합니다.`;
    if (list.length === 0) return `auctionConfig.candidates.${pos}에 후보가 없습니다.`;
    if (countPerPosition === null) countPerPosition = list.length;
    else if (list.length !== countPerPosition) {
      return '모든 포지션의 후보 인원이 동일해야 합니다.';
    }
    for (const puuid of list) {
      if (!puuid || typeof puuid !== 'string') return `auctionConfig.candidates.${pos}에 유효하지 않은 puuid가 있습니다.`;
      if (seen.has(puuid)) return '한 사람이 여러 포지션에 등록될 수 없습니다.';
      seen.add(puuid);
    }
  }
  return null;
};

const validateAuctionTeamBudget = (budget) => {
  if (!Number.isInteger(budget) || budget <= 0) {
    return 'budget은 양의 정수여야 합니다.';
  }
  return null;
};

const findCandidatePosition = (candidates, puuid) => {
  if (!candidates) return null;
  for (const pos of VALID_POSITIONS) {
    if ((candidates[pos] || []).includes(puuid)) return pos;
  }
  return null;
};

const collectCandidatePuuids = (candidates) => {
  const out = [];
  if (!candidates) return out;
  for (const pos of VALID_POSITIONS) {
    (candidates[pos] || []).forEach((p) => out.push(p));
  }
  return out;
};

// 포지션별 후보 수 (validateAuctionConfig가 모든 포지션 동일 길이를 보장하므로 top 기준)
const getCandidatesPerPosition = (candidates) => {
  if (!candidates || !Array.isArray(candidates.top)) return 0;
  return candidates.top.length;
};

const validateTrophyType = (trophyType) => {
  if (trophyType === null || trophyType === undefined) return null;
  if (typeof trophyType !== 'string' || !TROPHY_TYPES.includes(trophyType)) {
    return `trophyType은 다음 중 하나여야 합니다: ${TROPHY_TYPES.join(', ')}`;
  }
  return null;
};

const validateHeldAt = (heldAt) => {
  if (heldAt === null || heldAt === undefined || heldAt === '') {
    return 'heldAt(개최일)이 필요합니다.';
  }
  if (Number.isNaN(new Date(heldAt).getTime())) {
    return 'heldAt이 유효한 날짜가 아닙니다.';
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

// 수집기 자동 스크림 기록(게임당 1행)을 표시용 세트로 묶는다 — DB는 게임당 1행 유지(읽기 시점 그룹핑).
// 기준: 같은 팀쌍의 게임을 시간순 정렬해 인접 간격이 gapMs 이내면 같은 세트.
// 시간은 lcu_game_raws.gameCreation 기준(소급 업로드돼도 게임 시각으로 묶임), 없으면 createdAt 폴백.
// 수동 기록은 그대로 통과. 점수는 게임 단위 합산이라 승률·AI 예측 수치는 그룹핑 전후 동일하고,
// played(맞대결 횟수)만 게임 수 → 세트 수로 복원된다.
const SCRIM_GROUP_GAP_MS = 6 * 60 * 60 * 1000;

const groupCollectorScrims = (scrims, creationByGameKey = {}, gapMs = SCRIM_GROUP_GAP_MS) => {
  const manual = [];
  const collectorByPair = new Map();
  for (const s of scrims) {
    if (s.recordedByDiscordId !== 'collector') {
      manual.push(s);
      continue;
    }
    const pairKey =
      s.team1Id < s.team2Id ? `${s.team1Id}-${s.team2Id}` : `${s.team2Id}-${s.team1Id}`;
    if (!collectorByPair.has(pairKey)) collectorByPair.set(pairKey, []);
    collectorByPair.get(pairKey).push(s);
  }

  const timeOf = (s) => {
    const creation = s.riotGameKey && creationByGameKey[s.riotGameKey];
    return new Date(creation || s.createdAt).getTime();
  };

  const grouped = [];
  for (const rows of collectorByPair.values()) {
    rows.sort((a, b) => timeOf(a) - timeOf(b));
    let cur = null;
    let lastTime = 0;
    for (const s of rows) {
      const t = timeOf(s);
      if (!cur || t - lastTime > gapMs) {
        cur = {
          id: s.id,
          tournamentId: s.tournamentId,
          team1Id: s.team1Id,
          team2Id: s.team2Id,
          team1Score: 0,
          team2Score: 0,
          recordedByDiscordId: 'collector',
          // 소급 업로드돼도 "스크림을 한 날"이 표시·정렬 기준이 되도록 첫 게임 시각을 쓴다
          createdAt: new Date(t),
          gameCount: 0,
          ids: [],
        };
        grouped.push(cur);
      }
      // 세트 기준(첫 행)의 team1 관점으로 방향 정규화해 합산
      if (s.team1Id === cur.team1Id) {
        cur.team1Score += s.team1Score;
        cur.team2Score += s.team2Score;
      } else {
        cur.team1Score += s.team2Score;
        cur.team2Score += s.team1Score;
      }
      cur.gameCount += 1;
      cur.ids.push(s.id);
      lastTime = t;
    }
  }

  return [...manual, ...grouped].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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

// 개별 매치가 "시작됨"인지 판정. BYE/미정 매치(한쪽 또는 양쪽 슬롯이 null)는
// winnerTeamId가 자동 설정되거나 다음 라운드 placeholder라서 판정 대상에서 제외한다.
const isMatchStarted = (m, now = new Date()) => {
  if (m.team1Id == null || m.team2Id == null) return false;
  if (m.team1Score > 0 || m.team2Score > 0 || m.winnerTeamId != null) return true;
  if (m.scheduledAt && new Date(m.scheduledAt) <= now) return true;
  return false;
};

// ROLLING 모드: 양팀이 확정되고 아직 시작 안 한 매치만 예측 가능.
const isMatchPredictable = (m, now = new Date()) => m.team1Id != null && m.team2Id != null && !isMatchStarted(m, now);

// BRACKET 모드의 전체 잠금: 정상 매치가 하나라도 시작되면 전체 예측 동결.
const isTournamentLocked = (matches, now = new Date()) => matches.some((m) => isMatchStarted(m, now));

const validatePredictionsInput = ({
  predictions, matches, teams, existingPredictions = [], predictionMode = PREDICTION_MODES.BRACKET, now = new Date(),
}) => {
  if (!Array.isArray(predictions)) return 'predictions는 배열이어야 합니다.';
  const rolling = predictionMode === PREDICTION_MODES.ROLLING;
  const matchIds = new Set(matches.map((m) => m.id));
  const teamIds = new Set(teams.map((t) => t.id));
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const seenMatchIds = new Set();
  for (const p of predictions) {
    if (!p || !Number.isInteger(p.matchId)) return '각 예측에 matchId가 필요합니다.';
    if (!matchIds.has(p.matchId)) return '이 토너먼트에 속하지 않은 매치입니다.';
    if (seenMatchIds.has(p.matchId)) return '같은 매치에 중복된 예측이 있습니다.';
    seenMatchIds.add(p.matchId);
    const match = matchById.get(p.matchId);
    // ROLLING: 양팀 확정 + 미시작 매치만 변경 가능(예측/취소 모두). 시작됐거나 미정 매치는 거부.
    if (rolling && !isMatchPredictable(match, now)) {
      return '아직 대진이 확정되지 않았거나 이미 시작된 매치입니다.';
    }
    if (p.predictedTeamId !== null) {
      if (!Number.isInteger(p.predictedTeamId)) return 'predictedTeamId는 정수 또는 null이어야 합니다.';
      if (!teamIds.has(p.predictedTeamId)) return '이 토너먼트에 속하지 않은 팀입니다.';
      if (match.team1Id != null && match.team2Id != null) {
        if (p.predictedTeamId !== match.team1Id && p.predictedTeamId !== match.team2Id) {
          return '두 팀이 정해진 매치에서는 그중 한 팀만 선택할 수 있습니다.';
        }
      }
    }
  }

  // ROLLING은 완결성을 강제하지 않는다(지금 예측 가능한 매치만 순차로 찍으므로).
  if (rolling) return null;

  // BRACKET: BYE(한쪽 슬롯만 채워진 매치)를 제외한 모든 매치에 예측이 있어야 한다.
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

// 매치 N의 team1/team2 진출팀이 어느 부모 매치(직전 라운드)에서 왔는지 매핑.
// 부모 매치의 (round, slot)은 (N.round-1, N.bracketSlot*2) / (N.bracketSlot*2+1).
const buildParentMap = (matches) => {
  const byPos = new Map();
  for (const m of matches) {
    if (m.round != null && m.bracketSlot != null) {
      byPos.set(`${m.round}:${m.bracketSlot}`, m);
    }
  }
  const map = new Map();
  for (const m of matches) {
    if (m.round == null || m.bracketSlot == null || m.round <= 1) continue;
    const team1Parent = byPos.get(`${m.round - 1}:${m.bracketSlot * 2}`) || null;
    const team2Parent = byPos.get(`${m.round - 1}:${m.bracketSlot * 2 + 1}`) || null;
    map.set(m.id, { team1Parent, team2Parent });
  }
  return map;
};

// 브래킷 일관성(A2): 매치 N의 예측이 유효하려면 N의 양쪽 진출팀이 사용자의
// 이전 라운드 예측 트리에서 도달 가능해야 한다. 재귀적으로 모든 비BYE 조상 매치를 검증.
const isPredictionValidUnderTree = (userPuuid, match, parentMap, pickMap, memo) => {
  const memoKey = `${userPuuid}:${match.id}`;
  if (memo.has(memoKey)) return memo.get(memoKey);
  const parents = parentMap.get(match.id);
  if (!parents) {
    memo.set(memoKey, true);
    return true;
  }
  const checks = [
    { parent: parents.team1Parent, expected: match.team1Id },
    { parent: parents.team2Parent, expected: match.team2Id },
  ];
  for (const { parent, expected } of checks) {
    if (!parent) continue;
    // BYE 부모(한쪽만 채워진 매치)는 자동 진출이라 검증 패스.
    if (parent.team1Id == null || parent.team2Id == null) continue;
    if (expected == null) {
      memo.set(memoKey, false);
      return false;
    }
    const userPick = pickMap.get(`${userPuuid}:${parent.id}`);
    if (userPick !== expected) {
      memo.set(memoKey, false);
      return false;
    }
    if (!isPredictionValidUnderTree(userPuuid, parent, parentMap, pickMap, memo)) {
      memo.set(memoKey, false);
      return false;
    }
  }
  memo.set(memoKey, true);
  return true;
};

const enrichMatchesWithPredictions = (matches, predictions, predictionMode = PREDICTION_MODES.BRACKET, now = new Date()) => {
  const rolling = predictionMode === PREDICTION_MODES.ROLLING;
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const parentMap = buildParentMap(matches);
  const pickMap = new Map();
  for (const p of predictions) {
    pickMap.set(`${p.userPuuid}:${p.matchId}`, p.predictedTeamId);
  }
  const memo = new Map();
  // BRACKET은 전체 잠금 여부가 곧 각 매치의 예측 가능 여부. ROLLING은 매치별로 판정.
  const bracketLocked = rolling ? false : matches.some((m) => isMatchStarted(m, now));

  const byMatch = new Map();
  for (const p of predictions) {
    if (!byMatch.has(p.matchId)) byMatch.set(p.matchId, []);
    byMatch.get(p.matchId).push(p);
  }
  return matches.map((m) => {
    const data = m.toJSON ? m.toJSON() : { ...m };
    const list = byMatch.get(data.id) || [];
    // 양쪽 진출팀이 모두 결정된 매치만 카운트 활성화. 한쪽이 미정인 매치는 결정 대기.
    const active = data.team1Id != null && data.team2Id != null;
    let c1 = 0;
    let c2 = 0;
    let t1 = 0;
    let t2 = 0;
    const enrichedPredictions = list.map((p) => {
      // ROLLING은 예측 시점에 팀이 실제 결과로 확정돼 있어 트리 게이트가 무의미 → active면 유효.
      const valid = active
        ? (rolling ? true : isPredictionValidUnderTree(p.userPuuid, matchById.get(p.matchId), parentMap, pickMap, memo))
        : null;
      if (active) {
        if (p.predictedTeamId === data.team1Id) {
          t1 += 1;
          if (valid) c1 += 1;
        } else if (p.predictedTeamId === data.team2Id) {
          t2 += 1;
          if (valid) c2 += 1;
        }
      }
      return {
        userPuuid: p.userPuuid,
        summonerName: p.summonerName || null,
        predictedTeamId: p.predictedTeamId,
        updatedAt: p.updatedAt,
        isValid: valid,
        ...(p.isAi ? { isAi: true } : {}), // AI 가상 참가자 표시(프론트 스타일링용)
      };
    });
    const total = c1 + c2;
    data.predictions = enrichedPredictions;
    data.predictionsActive = active;
    // 이 매치를 지금 예측/변경할 수 있는지. 프론트가 카드별 입력 활성화에 사용.
    data.predictable = rolling ? isMatchPredictable(m, now) : !bracketLocked;
    data.team1PredictionCount = c1;
    data.team2PredictionCount = c2;
    data.team1PredictionPct = total > 0 ? c1 / total : null;
    data.team2PredictionPct = total > 0 ? c2 / total : null;
    // 자세히 보기용: 트리 일관성 무관, 진출팀과 일치하는 모든 예측 카운트.
    data.team1PredictionCountTotal = t1;
    data.team2PredictionCountTotal = t2;
    return data;
  });
};

const buildLeaderboard = (matches, predictions, predictionMode = PREDICTION_MODES.BRACKET) => {
  const rolling = predictionMode === PREDICTION_MODES.ROLLING;
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const parentMap = buildParentMap(matches);
  const pickMap = new Map();
  for (const p of predictions) {
    pickMap.set(`${p.userPuuid}:${p.matchId}`, p.predictedTeamId);
  }
  const memo = new Map();

  const byUser = new Map();
  for (const p of predictions) {
    const match = matchById.get(p.matchId);
    if (!match || match.winnerTeamId == null) continue;
    // ROLLING은 트리 게이트 없이 각 예측을 독립 적중으로 집계.
    const valid = rolling ? true : isPredictionValidUnderTree(p.userPuuid, match, parentMap, pickMap, memo);
    if (!byUser.has(p.userPuuid)) {
      byUser.set(p.userPuuid, {
        userPuuid: p.userPuuid,
        summonerName: p.summonerName || null,
        correctCount: 0,
        settledCount: 0,
        ...(p.isAi ? { isAi: true } : {}), // AI 가상 참가자 표시
      });
    }
    const entry = byUser.get(p.userPuuid);
    entry.settledCount += 1;
    if (valid && p.predictedTeamId === match.winnerTeamId) {
      entry.correctCount += 1;
    }
  }
  return [...byUser.values()].sort((a, b) => {
    if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
    return a.settledCount - b.settledCount;
  });
};

const validateAuctionTeamInput = ({ name, captainPuuid, members }) => {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return '팀명이 필요합니다.';
  }
  if (!captainPuuid || typeof captainPuuid !== 'string') {
    return '팀장 puuid가 필요합니다.';
  }
  if (!Array.isArray(members) || members.length !== 1) {
    return '경매 토너먼트의 팀은 팀장 1명만으로 시작해야 합니다.';
  }
  const captain = members[0];
  if (!captain || captain.puuid !== captainPuuid) {
    return '팀의 유일한 멤버는 팀장이어야 합니다.';
  }
  if (!VALID_POSITIONS.includes(captain.position)) {
    return '유효하지 않은 포지션입니다.';
  }
  return null;
};

const startAuction = async (tournament, teams, options = {}) => {
  if (tournament.type !== TYPES.AUCTION) {
    return { ok: false, error: '경매 타입 토너먼트만 경매를 시작할 수 있습니다.' };
  }
  if (tournament.status !== STATUS.PREPARING) {
    return { ok: false, error: '준비중인 토너먼트만 경매를 시작할 수 있습니다.' };
  }
  if (!tournament.auctionConfig) {
    return { ok: false, error: 'auctionConfig가 설정되어 있지 않습니다.' };
  }
  if (teams.length < 2) {
    return { ok: false, error: '최소 2팀이 등록되어야 경매를 시작할 수 있습니다.' };
  }
  const { candidates } = tournament.auctionConfig;
  const candidatesPerPosition = getCandidatesPerPosition(candidates);
  if (teams.length !== candidatesPerPosition) {
    return {
      ok: false,
      error: `팀 수(${teams.length})와 포지션별 후보 수(${candidatesPerPosition})가 일치해야 합니다.`,
    };
  }
  const captainSet = new Set();
  for (const team of teams) {
    const members = team.members || [];
    if (members.length !== 1) {
      return { ok: false, error: `${team.name} 팀이 팀장 1명만으로 구성되어야 합니다.` };
    }
    const captain = members[0];
    if (captain.puuid !== team.captainPuuid) {
      return { ok: false, error: `${team.name} 팀의 멤버와 captainPuuid가 일치하지 않습니다.` };
    }
    const candidatePos = findCandidatePosition(candidates, captain.puuid);
    if (!candidatePos) {
      return { ok: false, error: `${team.name} 팀의 팀장이 후보 풀에 없습니다.` };
    }
    if (candidatePos !== captain.position) {
      return { ok: false, error: `${team.name} 팀의 팀장 포지션이 후보 풀과 일치하지 않습니다.` };
    }
    if (captainSet.has(captain.puuid)) {
      return { ok: false, error: '여러 팀이 같은 팀장을 가질 수 없습니다.' };
    }
    captainSet.add(captain.puuid);
    if (!Number.isInteger(team.auctionBudget) || team.auctionBudget <= 0) {
      return { ok: false, error: `${team.name} 팀에 경매 예산(auctionBudget)이 설정되어 있지 않습니다.` };
    }
  }
  for (const team of teams) {
    team.remainingBudget = team.auctionBudget;
    await team.save({ transaction: options.transaction });
  }
  tournament.status = STATUS.AUCTION;
  tournament.auctionOfferedPuuids = []; // 경매 시작 시 패스 상태 초기화
  await tournament.save({ transaction: options.transaction });
  return { ok: true };
};

const recordAuctionBid = async (tournament, team, allTeams, { puuid, amount }, options = {}) => {
  if (tournament.status !== STATUS.AUCTION) {
    return { ok: false, error: '경매 단계가 아닙니다.' };
  }
  const config = tournament.auctionConfig || {};
  if (!puuid || typeof puuid !== 'string') {
    return { ok: false, error: 'puuid가 필요합니다.' };
  }
  if (!Number.isInteger(amount) || amount < config.minBid) {
    return { ok: false, error: `입찰가는 ${config.minBid} 이상의 정수여야 합니다.` };
  }
  const position = findCandidatePosition(config.candidates, puuid);
  if (!position) {
    return { ok: false, error: '후보 풀에 없는 puuid입니다.' };
  }
  for (const t of allTeams) {
    if ((t.members || []).some((m) => m.puuid === puuid)) {
      return { ok: false, error: '이미 다른 팀에 낙찰된 후보입니다.' };
    }
  }
  if ((team.members || []).some((m) => m.position === position)) {
    return { ok: false, error: `해당 팀에 ${position} 포지션이 이미 있습니다.` };
  }
  if ((team.members || []).length >= TEAM_SIZE) {
    return { ok: false, error: '팀 정원이 가득 찼습니다.' };
  }
  const newBudget = (team.remainingBudget == null ? 0 : team.remainingBudget) - amount;
  if (newBudget < 0 && !config.allowNegative) {
    return { ok: false, error: '잔여 예산을 초과합니다.' };
  }
  team.members = [...(team.members || []), { puuid, position, bidAmount: amount }];
  team.remainingBudget = newBudget;
  await team.save({ transaction: options.transaction });

  // 낙찰된 puuid가 현재 매물이라면 현재 매물 정보 클리어
  let cleared = false;
  if (tournament.currentAuctionPuuid === puuid) {
    tournament.currentAuctionPuuid = null;
    tournament.currentAuctionDeadline = null;
    await tournament.save({ transaction: options.transaction });
    cleared = true;
  }
  return { ok: true, position, currentAuctionCleared: cleared };
};

const undoAuctionBid = async (tournament, team, puuid, options = {}) => {
  if (tournament.status !== STATUS.AUCTION) {
    return { ok: false, error: '경매 단계가 아닙니다.' };
  }
  const members = team.members || [];
  const target = members.find((m) => m.puuid === puuid);
  if (!target) {
    return { ok: false, error: '해당 팀에 그 후보가 없습니다.' };
  }
  if (target.puuid === team.captainPuuid) {
    return { ok: false, error: '팀장은 입찰 취소할 수 없습니다.' };
  }
  const refund = target.bidAmount || 0;
  team.members = members.filter((m) => m.puuid !== puuid);
  team.remainingBudget = (team.remainingBudget || 0) + refund;
  await team.save({ transaction: options.transaction });
  return { ok: true, refund };
};

// 다음 매물을 랜덤으로 뽑는다. 낙찰된 사람은 제외하고, "이번 패스에 이미 올라온 사람"도
// 패스가 끝날 때까지 다시 뽑지 않는다. 남은(유찰) 사람이 모두 이번 패스에 나왔으면
// offered를 비우고 새 패스를 시작해 유찰자들끼리 다시 랜덤으로 돌린다.
// @returns {{ puuid, position, offeredPuuids }} | null  offeredPuuids=저장할 새 offered 목록
const pickRandomCandidate = (tournament, teams) => {
  const candidates = tournament.auctionConfig && tournament.auctionConfig.candidates;
  if (!candidates) return null;
  const allPuuids = collectCandidatePuuids(candidates);
  const taken = new Set();
  for (const team of teams) {
    (team.members || []).forEach((m) => taken.add(m.puuid));
  }
  const notSold = allPuuids.filter((p) => !taken.has(p));
  if (notSold.length === 0) return null;

  const offeredArr = Array.isArray(tournament.auctionOfferedPuuids) ? tournament.auctionOfferedPuuids : [];
  const offered = new Set(offeredArr);
  const notOffered = notSold.filter((p) => !offered.has(p));
  const startNewPass = notOffered.length === 0; // 남은 사람이 다 이번 패스에 나옴 → 새 패스
  const pool = startNewPass ? notSold : notOffered;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  const offeredPuuids = startNewPass ? [picked] : [...offeredArr, picked];
  return { puuid: picked, position: findCandidatePosition(candidates, picked), offeredPuuids };
};

// 한 포지션의 미낙찰 후보가 정확히 1명 남으면, 그 포지션이 빈 팀은 정확히 1팀뿐이라
// 그 후보는 남은 팀에 고정될 수밖에 없다(후보 수 = 팀 수). 그런 "강제 배정" 대상을 찾는다.
// @returns {{ puuid, position, teamId, teamName }} | null
const findForcedAssignment = (tournament, teams) => {
  const candidates = tournament.auctionConfig && tournament.auctionConfig.candidates;
  if (!candidates) return null;
  const taken = new Set();
  for (const team of teams) {
    (team.members || []).forEach((m) => taken.add(m.puuid));
  }
  for (const position of VALID_POSITIONS) {
    const unsold = (candidates[position] || []).filter((p) => !taken.has(p));
    if (unsold.length !== 1) continue;
    // 그 포지션이 비어있는(정원 미달) 팀 = 정확히 1팀
    const team = teams.find(
      (t) => (t.members || []).length < TEAM_SIZE
        && !(t.members || []).some((m) => m.position === position),
    );
    if (team) {
      return { puuid: unsold[0], position, teamId: team.id, teamName: team.name, reason: 'last_candidate' };
    }
  }
  return null;
};

// 데드락 해소: 어떤 포지션의 남은 후보가 2명 이상인데, 그 포지션이 빈 팀 중
// 최소입찰(minBid)을 낼 수 있는(remainingBudget >= minBid) 팀이 0팀이면 정상 경매가
// 영원히 유찰된다. 이때 남은 후보 1명을 빈 팀 1개에 랜덤으로 0원 배정한다.
// 1명씩 처리 → 남은 후보/빈 팀이 함께 줄어 결국 1명 남으면 findForcedAssignment가 마무리 → 수렴.
// @returns {{ puuid, position, teamId, teamName, reason }} | null
const findDeadlockAssignment = (tournament, teams) => {
  const config = tournament.auctionConfig || {};
  const { candidates, minBid } = config;
  if (!candidates || !Number.isInteger(minBid)) return null;
  const taken = new Set();
  for (const team of teams) {
    (team.members || []).forEach((m) => taken.add(m.puuid));
  }
  for (const position of VALID_POSITIONS) {
    const unsold = (candidates[position] || []).filter((p) => !taken.has(p));
    if (unsold.length < 2) continue; // 1명 남음은 findForcedAssignment가 처리
    const missingTeams = teams.filter(
      (t) => (t.members || []).length < TEAM_SIZE
        && !(t.members || []).some((m) => m.position === position),
    );
    if (missingTeams.length === 0) continue;
    // 최소입찰을 낼 수 있는 빈 팀이 하나라도 있으면 정상 경매에 맡긴다.
    const canBid = missingTeams.filter((t) => (t.remainingBudget == null ? 0 : t.remainingBudget) >= minBid);
    if (canBid.length > 0) continue;
    // 데드락: 남은 후보/빈 팀에서 랜덤으로 하나씩 뽑아 0원 배정
    const puuid = unsold[Math.floor(Math.random() * unsold.length)];
    const team = missingTeams[Math.floor(Math.random() * missingTeams.length)];
    return { puuid, position, teamId: team.id, teamName: team.name, reason: 'deadlock_random' };
  }
  return null;
};

// 강제 0원 배정: 포지션 마지막 후보를 남은 팀에 붙인다(입찰/최소가/예산 검증 없이).
const forceAssignCandidate = async (tournament, team, { puuid, position }, options = {}) => {
  if (tournament.status !== STATUS.AUCTION) {
    return { ok: false, error: '경매 단계가 아닙니다.' };
  }
  if ((team.members || []).some((m) => m.position === position)) {
    return { ok: false, error: '해당 팀에 이미 그 포지션이 있습니다.' };
  }
  if ((team.members || []).some((m) => m.puuid === puuid)) {
    return { ok: false, error: '이미 배정된 후보입니다.' };
  }
  team.members = [...(team.members || []), { puuid, position, bidAmount: 0 }];
  await team.save({ transaction: options.transaction });
  // 강제 배정 후 현재 매물/타이머는 비운다.
  tournament.currentAuctionPuuid = null;
  tournament.currentAuctionDeadline = null;
  await tournament.save({ transaction: options.transaction });
  return { ok: true };
};

const setCurrentAuction = async (tournament, puuid, options = {}) => {
  if (tournament.status !== STATUS.AUCTION) {
    return { ok: false, error: '경매 단계가 아닙니다.' };
  }
  // 입찰 진행 중(deadline이 미래)이면 매물 교체 불가
  if (tournament.currentAuctionDeadline && new Date(tournament.currentAuctionDeadline) > new Date()) {
    return { ok: false, error: '입찰이 진행 중입니다.' };
  }
  tournament.currentAuctionPuuid = puuid;
  tournament.currentAuctionDeadline = null;
  await tournament.save({ transaction: options.transaction });
  return { ok: true };
};

const startBidTimer = async (tournament, options = {}) => {
  if (tournament.status !== STATUS.AUCTION) {
    return { ok: false, error: '경매 단계가 아닙니다.' };
  }
  if (!tournament.currentAuctionPuuid) {
    return { ok: false, error: '현재 매물이 없습니다.' };
  }
  const duration = tournament.auctionConfig && tournament.auctionConfig.bidDurationSeconds;
  if (!Number.isInteger(duration) || duration <= 0) {
    return { ok: false, error: 'auctionConfig.bidDurationSeconds가 설정되어 있지 않습니다.' };
  }
  const deadline = new Date(Date.now() + duration * 1000);
  tournament.currentAuctionDeadline = deadline;
  await tournament.save({ transaction: options.transaction });
  return { ok: true, deadline, durationSeconds: duration };
};

const extendBidTimer = async (tournament, options = {}) => {
  if (tournament.status !== STATUS.AUCTION) {
    return { ok: false, error: '경매 단계가 아닙니다.' };
  }
  if (!tournament.currentAuctionDeadline) {
    return { ok: false, error: '진행 중인 입찰이 없습니다.' };
  }
  const duration = tournament.auctionConfig && tournament.auctionConfig.bidDurationSeconds;
  if (!Number.isInteger(duration) || duration <= 0) {
    return { ok: false, error: 'auctionConfig.bidDurationSeconds가 설정되어 있지 않습니다.' };
  }
  const deadline = new Date(Date.now() + duration * 1000);
  tournament.currentAuctionDeadline = deadline;
  await tournament.save({ transaction: options.transaction });
  return { ok: true, deadline, durationSeconds: duration };
};

// 입찰 즉시 마감: 진행 중인 입찰의 deadline을 현재 시각으로 만료시킨다.
// 매물(currentAuctionPuuid)은 유지하고, 시간만 끝내 낙찰 단계로 넘긴다.
const endBidTimer = async (tournament, options = {}) => {
  if (tournament.status !== STATUS.AUCTION) {
    return { ok: false, error: '경매 단계가 아닙니다.' };
  }
  if (!tournament.currentAuctionDeadline || new Date(tournament.currentAuctionDeadline) <= new Date()) {
    return { ok: false, error: '진행 중인 입찰이 없습니다.' };
  }
  const deadline = new Date();
  tournament.currentAuctionDeadline = deadline;
  await tournament.save({ transaction: options.transaction });
  return { ok: true, deadline };
};

const clearCurrentAuction = async (tournament, options = {}) => {
  tournament.currentAuctionPuuid = null;
  tournament.currentAuctionDeadline = null;
  await tournament.save({ transaction: options.transaction });
};

const completeAuction = async (tournament, teams, options = {}) => {
  if (tournament.status !== STATUS.AUCTION) {
    return { ok: false, error: '경매 단계가 아닙니다.' };
  }
  for (const team of teams) {
    if ((team.members || []).length !== TEAM_SIZE) {
      return { ok: false, error: `${team.name} 팀이 아직 ${TEAM_SIZE}명을 채우지 못했습니다.` };
    }
  }
  tournament.status = STATUS.PREPARING;
  await tournament.save({ transaction: options.transaction });
  return { ok: true };
};

module.exports = {
  TEAM_SIZE,
  VALID_POSITIONS,
  STATUS,
  TYPES,
  PREDICTION_MODES,
  TROPHY_TYPES,
  validateTrophyType,
  validateHeldAt,
  validateTournamentType,
  validatePredictionMode,
  validateAuctionConfig,
  validateAuctionTeamInput,
  validateAuctionTeamBudget,
  findCandidatePosition,
  collectCandidatePuuids,
  getCandidatesPerPosition,
  startAuction,
  recordAuctionBid,
  undoAuctionBid,
  completeAuction,
  pickRandomCandidate,
  findForcedAssignment,
  findDeadlockAssignment,
  forceAssignCandidate,
  setCurrentAuction,
  startBidTimer,
  extendBidTimer,
  endBidTimer,
  clearCurrentAuction,
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
  groupCollectorScrims,
  isMatchStarted,
  isMatchPredictable,
  isTournamentLocked,
  validatePredictionsInput,
  applyPredictions,
  enrichMatchesWithPredictions,
  buildLeaderboard,
  findPerfectPredictors,
  handleTournamentFinishedAchievements,
};
