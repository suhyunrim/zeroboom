const { Op } = require('sequelize');
const models = require('../db/models');

const TEAM_SIZE = 5;
const VALID_POSITIONS = ['top', 'jungle', 'mid', 'adc', 'support'];

/**
 * 다음 2의 거듭제곱(>= teamCount). 최소 2.
 */
const computeBracketSize = (teamCount) => {
  if (teamCount < 2) return 2;
  return 2 ** Math.ceil(Math.log2(teamCount));
};

/**
 * BO 매치의 승리 조건 점수 (ceil(bestOf / 2)).
 */
const getWinningScore = (bestOf) => Math.ceil(bestOf / 2);

/**
 * 라운드 라벨 계산. teamCount < bracketSize 이면 R1은 '예선'.
 * 이외는 결승/4강/8강/... 로 채움.
 */
const computeRoundLabels = (bracketSize, teamCount) => {
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

/**
 * (round, slot) 기준 다음 매치 위치 반환.
 * 다음 매치의 어느 슬롯(team1/team2)으로 진출하는지도 포함.
 */
const getNextMatchPosition = (round, slot) => ({
  round: round + 1,
  slot: Math.floor(slot / 2),
  side: slot % 2 === 0 ? 'team1' : 'team2',
});

/**
 * BO 매치 점수 유효성 검증.
 * 승자는 정확히 winningScore, 패자는 winningScore 미만, 둘 다 음수 아님.
 */
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

/**
 * 팀 멤버 입력 검증. 5명, puuid 중복 없음, 포지션 유효, 팀장이 멤버에 있음.
 */
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

/**
 * 표준 ELO 승률: P(A) = 1 / (1 + 10^((R_B - R_A) / 400)).
 * 한쪽 레이팅이 없으면 null.
 */
const computeWinProbability = (ratingA, ratingB) => {
  if (ratingA == null || ratingB == null) return null;
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
};

/**
 * 팀 멤버 puuid 배열로 평균 레이팅 계산.
 * ratingByPuuid: { puuid: rating } 맵. 누락된 puuid는 평균에서 제외.
 * 한 명도 없으면 null.
 */
const computeTeamAvgRating = (members, ratingByPuuid) => {
  const ratings = members.map((m) => ratingByPuuid[m.puuid]).filter((r) => r != null);
  if (ratings.length === 0) return null;
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
};

/**
 * 그룹 등록 유저인지 확인 (모든 멤버 puuid가 user 테이블에 존재해야 함).
 */
const verifyMembersInGroup = async (groupId, puuids) => {
  const rows = await models.user.findAll({
    where: { groupId, puuid: puuids },
    attributes: ['puuid'],
  });
  return rows.length === puuids.length;
};

/**
 * 토너먼트 내 다른 팀에 puuid가 이미 등록되어 있는지 확인.
 * excludeTeamId: 본인 팀 제외 (수정 시 사용).
 */
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

/**
 * 토너먼트의 모든 매치 행을 빈 상태로 미리 생성.
 * 결승 라운드만 finalBestOf 적용.
 */
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

/**
 * 1라운드 슬롯 매핑(teamId 또는 null 배열, 길이 = bracketSize)을 받아
 * R1 매치들의 team1Id/team2Id를 채운다. 한쪽만 팀이면 BYE → 즉시 winner 설정 후 다음 라운드 진출.
 */
const placeTeamsAndResolveByes = async (tournament, slotMapping) => {
  const r1Matches = await models.tournament_match.findAll({
    where: { tournamentId: tournament.id, round: 1 },
    order: [['bracketSlot', 'ASC']],
  });

  for (const match of r1Matches) {
    const team1Id = slotMapping[match.bracketSlot * 2] || null;
    const team2Id = slotMapping[match.bracketSlot * 2 + 1] || null;
    match.team1Id = team1Id;
    match.team2Id = team2Id;

    // BYE 처리: 한쪽 팀만 있으면 자동 진출
    if ((team1Id && !team2Id) || (!team1Id && team2Id)) {
      const winnerTeamId = team1Id || team2Id;
      match.winnerTeamId = winnerTeamId;
      await match.save();
      await propagateWinner(tournament, match.round, match.bracketSlot, winnerTeamId);
    } else {
      await match.save();
    }
  }
};

/**
 * (round, slot) 매치의 승자를 다음 라운드 매치에 진출시킨다.
 * 다음 매치의 두 슬롯이 모두 BYE 결과로 차면 그 매치도 자동으로 BYE 처리되어 또 진출.
 * 결승이면 챔피언 + status='finished' 처리.
 */
const propagateWinner = async (tournament, round, slot, winnerTeamId) => {
  const totalRounds = Math.log2(tournament.bracketSize);
  if (round === totalRounds) {
    tournament.championTeamId = winnerTeamId;
    tournament.status = 'finished';
    await tournament.save();
    return;
  }

  const next = getNextMatchPosition(round, slot);
  const nextMatch = await models.tournament_match.findOne({
    where: { tournamentId: tournament.id, round: next.round, bracketSlot: next.slot },
  });
  if (!nextMatch) return;

  if (next.side === 'team1') nextMatch.team1Id = winnerTeamId;
  else nextMatch.team2Id = winnerTeamId;

  // 다음 매치도 한쪽만 채워진 채 다른 쪽이 영원히 안 올 수 있음 (인접 슬롯이 둘 다 BYE인 케이스).
  // 양 슬롯이 다 채워졌지만 한쪽이 null인 경우: 형제 매치가 아직 안 끝났을 수도, 혹은 BYE 결과일 수도.
  // BYE-only 진출은 R1에서만 발생하므로 R2에서 형제 슬롯이 null로 남는 경우는
  // 형제 R1 매치도 BYE-only인 경우뿐. 그 매치도 winnerTeamId가 null이면 양쪽 다 BYE.
  // 양쪽 다 BYE면 nextMatch는 진행 불가 상태가 되지만, 실제로는 슬롯 매핑 단계에서
  // 한 매치 안에 두 BYE가 들어가지 않도록 클라이언트가 막아야 한다.
  await nextMatch.save();
};

/**
 * 매치 결과 기록. 점수 검증 → winner 결정 → 다음 라운드 진출.
 */
const recordMatchResult = async (match, team1Score, team2Score) => {
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
  await match.save();

  const tournament = await models.tournament.findByPk(match.tournamentId);
  await propagateWinner(tournament, match.round, match.bracketSlot, winnerTeamId);

  return { ok: true, match, tournament };
};

module.exports = {
  TEAM_SIZE,
  VALID_POSITIONS,
  computeBracketSize,
  getWinningScore,
  computeRoundLabels,
  getNextMatchPosition,
  validateScore,
  validateTeamInput,
  verifyMembersInGroup,
  findDuplicatePuuids,
  generateMatchRows,
  placeTeamsAndResolveByes,
  propagateWinner,
  recordMatchResult,
  computeWinProbability,
  computeTeamAvgRating,
};
