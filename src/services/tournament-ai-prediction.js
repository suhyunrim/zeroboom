/**
 * 대회 매치별 AI 승부예측 — 유저처럼 "기록으로 남는" 예측.
 *
 * 유저 예측과 같은 정보 마감선을 따른다:
 *  - rolling: 매치별 — 대진 확정 시 기록, 그 매치가 시작(isMatchStarted)되기 전까지 이벤트마다 갱신.
 *  - bracket: 대진표 생성 직후 전체 트리를 시뮬레이션(예측 승자가 다음 라운드 진출)해 전 매치 기록,
 *             대회 첫 매치 시작(isTournamentLocked) 전까지 갱신 후 전체 동결.
 * 갱신은 스케줄이 아니라 이벤트 훅(대진표 생성/매치 결과 입력/스크림 기록/팀 수정)에서 일어난다 —
 * 예측에 영향 주는 데이터 변경은 전부 서버 액션이므로 시간 경과만으로 재계산할 이유가 없다.
 * 동결은 "쓰기 대상에서 제외"로 구현된다(시작된 매치/잠긴 대회는 upsert 목록에 안 들어감).
 */
const models = require('../db/models');
const { logger } = require('../loaders/logger');
const bridges = require('./ai/bridges');

// 리더보드/예측 목록에 주입되는 AI 가상 참가자 식별자(실 puuid와 충돌하지 않는 형식)
const AI_USER_PUUID = '__zeroboom_ai__';
const AI_DISPLAY_NAME = 'ZeroBoom AI';

const PREDICTION_NOTE = 'winProb=이 매치에서 이길 확률(%). 팀 평균 내전 레이팅에 포지션 적합도(솔랭+내전 이력 혼합)·팀 시너지를 반영하고, '
  + '두 팀의 스크림 맞대결이 있으면 표본 크기만큼 가중해 합산한 추정치입니다(실제 결과와 다를 수 있음).';

// 팀 팩터 → 저장/표시용 안전 투영 (raw avgRating/teamId 제거)
function projectTeamFactors(team, winProb) {
  return {
    name: team.name,
    winProb, // 이 매치에서 이길 확률(%)
    teamRatingTier: team.teamRatingTier,
    positionFitScore: team.positionFitScore ?? null,
    synergyPct: team.synergyPct ?? null,
    scrimRecord: team.scrimRecord || { won: 0, lost: 0, played: 0 },
    members: team.members,
  };
}

// 한 매치업(a=team1측, b=team2측)의 AI 예측 행. 무레이팅 등으로 확률을 못 내면 null.
function computeMatchRow(tournamentId, matchId, a, b, factors, now) {
  const pair = bridges.computeCompositeStandings([a, b], {
    expected: factors.expected,
    pairScrim: factors.pairScrim,
  });
  const probByTeamId = {};
  pair.forEach((p) => { probByTeamId[p.teamId] = p.expectedWinRate; });
  const p1 = probByTeamId[a.teamId] ?? null;
  const p2 = probByTeamId[b.teamId] ?? null;
  if (p1 == null || p2 == null) return null;

  const tournamentController = require('../controller/tournament');
  const h2h = tournamentController.computeHeadToHeadScrim(a.teamId, b.teamId, factors.scrims);

  return {
    tournamentId,
    matchId,
    predictedTeamId: p1 >= p2 ? a.teamId : b.teamId,
    team1WinProb: p1,
    team2WinProb: p2,
    factors: {
      team1: projectTeamFactors(a, p1),
      team2: projectTeamFactors(b, p2),
      headToHeadScrim: h2h.played > 0 ? h2h : null,
    },
    computedAt: now,
  };
}

// bracket 모드: 전체 트리 시뮬레이션. 팀이 미정인 상위 라운드는 "예측 승자"가 진출한 것으로 가정해
// 전 매치(BYE 제외)를 예측한다 — 유저의 bracket 예측(전체 미리 찍기)과 같은 형태.
function simulateBracketRows(tournamentId, matches, factors, now) {
  const byPos = new Map(matches.map((m) => [`${m.round}:${m.bracketSlot}`, m]));
  const winnerOf = new Map(); // matchId -> 진출 팀(실제 부전승 또는 예측 승자)
  const rows = [];
  const sorted = [...matches].sort((x, y) => x.round - y.round || x.bracketSlot - y.bracketSlot);
  for (const m of sorted) {
    const childA = byPos.get(`${m.round - 1}:${m.bracketSlot * 2}`);
    const childB = byPos.get(`${m.round - 1}:${m.bracketSlot * 2 + 1}`);
    const t1Id = m.team1Id != null ? m.team1Id : (childA ? winnerOf.get(childA.id) ?? null : null);
    const t2Id = m.team2Id != null ? m.team2Id : (childB ? winnerOf.get(childB.id) ?? null : null);

    // 한쪽만 있으면 BYE(실제든 예측 트리상이든) — 예측 행 없이 그 팀이 진출
    if ((t1Id != null) !== (t2Id != null)) {
      winnerOf.set(m.id, t1Id != null ? t1Id : t2Id);
      continue;
    }
    if (t1Id == null || t2Id == null) continue; // 양쪽 다 미정(하위에서 예측 불가로 끊김)

    const a = factors.teamById[t1Id];
    const b = factors.teamById[t2Id];
    if (!a || !b) continue;
    const row = computeMatchRow(tournamentId, m.id, a, b, factors, now);
    if (!row) continue; // 무레이팅 → 이 가지 예측 불가
    rows.push(row);
    winnerOf.set(m.id, row.predictedTeamId);
  }
  return rows;
}

/**
 * 대회의 AI 예측을 재계산해 upsert. 이벤트 훅(대진표 생성/결과 입력/스크림/팀 수정)에서 호출.
 * 마감 지난 대상(시작된 매치, 잠긴 bracket 대회)은 건드리지 않는다(동결).
 * @param {object|number} tournamentOrId - tournament 인스턴스(또는 id)
 * @returns {Promise<{written:number}>}
 */
async function refreshAiPredictions(tournamentOrId) {
  const tournament = typeof tournamentOrId === 'object' && tournamentOrId !== null
    ? tournamentOrId
    : await models.tournament.findByPk(tournamentOrId);
  if (!tournament || tournament.status === 'finished') return { written: 0 };

  const matches = await models.tournament_match.findAll({
    where: { tournamentId: tournament.id },
    raw: true,
  });
  if (!matches.length) return { written: 0 };

  const tournamentController = require('../controller/tournament');
  const now = new Date();
  const rolling = tournament.predictionMode === tournamentController.PREDICTION_MODES.ROLLING;
  // bracket: 첫 매치가 시작되면 전체 동결(유저 예측과 동일 마감)
  if (!rolling && tournamentController.isTournamentLocked(matches, now)) return { written: 0 };

  const factors = await bridges.buildTeamFactors(tournament.groupId, tournament.id);
  if (!factors.teams || !factors.teams.length) return { written: 0 };

  let rows;
  if (rolling) {
    // rolling: 양팀 확정 + 미시작 매치만(시작된 매치는 목록에서 빠져 동결 유지)
    rows = matches
      .filter((m) => tournamentController.isMatchPredictable(m, now))
      .map((m) => {
        const a = factors.teamById[m.team1Id];
        const b = factors.teamById[m.team2Id];
        return a && b ? computeMatchRow(tournament.id, m.id, a, b, factors, now) : null;
      })
      .filter(Boolean);
  } else {
    rows = simulateBracketRows(tournament.id, matches, factors, now);
  }

  if (rows.length) {
    await models.tournament_match_ai_prediction.bulkCreate(rows, {
      updateOnDuplicate: ['predictedTeamId', 'team1WinProb', 'team2WinProb', 'factors', 'computedAt', 'updatedAt'],
    });
  }
  return { written: rows.length };
}

// 라우트에서 fire-and-forget으로 쓰는 래퍼 — 예측 갱신 실패가 본 요청을 막지 않게 한다.
function refreshInBackground(tournamentOrId, source) {
  refreshAiPredictions(tournamentOrId).catch((e) => {
    logger.error(`[ai-prediction] refresh 실패(${source}): ${e.message}`);
  });
}

// 저장 행 → 유저 예측 배열에 섞어 넣을 수 있는 형태(리더보드/매치별 예측 목록 주입용)
function toPredictionEntries(aiRows) {
  return (aiRows || []).map((r) => ({
    matchId: r.matchId,
    userPuuid: AI_USER_PUUID,
    predictedTeamId: r.predictedTeamId,
    summonerName: AI_DISPLAY_NAME,
    updatedAt: r.computedAt,
    isAi: true,
  }));
}

module.exports = {
  AI_USER_PUUID,
  AI_DISPLAY_NAME,
  PREDICTION_NOTE,
  refreshAiPredictions,
  refreshInBackground,
  toPredictionEntries,
  // 순수 코어(테스트)
  computeMatchRow,
  simulateBracketRows,
  projectTeamFactors,
};
