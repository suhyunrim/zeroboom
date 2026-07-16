const { Op } = require('sequelize');
const models = require('../db/models');
const { logger } = require('../loaders/logger');

// roleBoundItem(협곡 퀘스트 보상 아이템) → 포지션 매핑
// 1220/1221=상단 퀘스트 보상, 1209=정글, 1206=중단, 1208=서포터 퀘스트 보상, 2055=서폿 제어와드 슬롯
// 원딜은 신발류 ID(빌드마다 다름)라 매핑 불가 → 소거법으로 판정
const QUEST_ITEM_POSITIONS = {
  1220: 'TOP',
  1221: 'TOP',
  1209: 'JUNGLE',
  1206: 'MIDDLE',
  1208: 'UTILITY',
  2055: 'UTILITY',
};
const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const SMITE_SPELL_ID = 11;

const MATCH_TIME_WINDOW_MS = 3 * 60 * 60 * 1000; // 내전 match 기록과 게임 시작 시각 허용 오차
const MIN_PUUID_OVERLAP = 8; // 10명 중 8명 이상 일치해야 같은 판으로 인정

// raw 게임 JSON에서 참가자 10명의 필요한 필드만 추출
function extractPlayers(game) {
  const identities = new Map(
    (game.participantIdentities || []).map((it) => [it.participantId, it.player || {}]),
  );
  return (game.participants || []).map((p) => {
    const who = identities.get(p.participantId) || {};
    const s = p.stats || {};
    return {
      participantId: p.participantId,
      puuid: who.puuid,
      gameName: who.gameName,
      tagLine: who.tagLine,
      teamId: p.teamId,
      championId: p.championId,
      spell1Id: p.spell1Id,
      spell2Id: p.spell2Id,
      roleBoundItem: s.roleBoundItem || 0,
      kills: s.kills || 0,
      deaths: s.deaths || 0,
      assists: s.assists || 0,
      cs: (s.totalMinionsKilled || 0) + (s.neutralMinionsKilled || 0),
      neutralCs: s.neutralMinionsKilled || 0,
      goldEarned: s.goldEarned || 0,
      damageToChampions: s.totalDamageDealtToChampions || 0,
      damageTaken: s.totalDamageTaken || 0,
      visionScore: s.visionScore || 0,
      win: !!s.win,
    };
  });
}

// 한 팀(5명)의 포지션 판정. roleBoundItem 우선, 남는 자리는 휴리스틱+소거법.
// 반환: Map<participantId, position|null>
function resolveTeamPositions(teamPlayers) {
  const result = new Map(teamPlayers.map((p) => [p.participantId, null]));
  const openPositions = new Set(POSITIONS);
  let unassigned = [...teamPlayers];

  // 1차: 퀘스트 아이템 매핑 (같은 포지션을 둘이 주장하면 양쪽 다 보류)
  const claims = new Map(); // position → players[]
  for (const p of unassigned) {
    const pos = QUEST_ITEM_POSITIONS[p.roleBoundItem];
    if (pos) {
      if (!claims.has(pos)) claims.set(pos, []);
      claims.get(pos).push(p);
    }
  }
  for (const [pos, players] of claims) {
    if (players.length === 1 && openPositions.has(pos)) {
      result.set(players[0].participantId, pos);
      openPositions.delete(pos);
      unassigned = unassigned.filter((p) => p.participantId !== players[0].participantId);
    }
  }

  // 2차: 정글 휴리스틱 — 강타 보유자 중 정글몹 CS 최다
  if (openPositions.has('JUNGLE')) {
    const smiters = unassigned
      .filter((p) => p.spell1Id === SMITE_SPELL_ID || p.spell2Id === SMITE_SPELL_ID)
      .sort((a, b) => b.neutralCs - a.neutralCs);
    if (smiters.length > 0) {
      result.set(smiters[0].participantId, 'JUNGLE');
      openPositions.delete('JUNGLE');
      unassigned = unassigned.filter((p) => p.participantId !== smiters[0].participantId);
    }
  }

  // 3차: 서폿 휴리스틱 — 남은 인원 중 CS 최저 (라이너와 확연히 구분될 때만)
  if (openPositions.has('UTILITY') && unassigned.length > 1) {
    const sorted = [...unassigned].sort((a, b) => a.cs - b.cs);
    if (sorted[0].cs < sorted[1].cs * 0.5) {
      result.set(sorted[0].participantId, 'UTILITY');
      openPositions.delete('UTILITY');
      unassigned = unassigned.filter((p) => p.participantId !== sorted[0].participantId);
    }
  }

  // 소거법: 한 자리에 한 명 남았으면 확정
  if (openPositions.size === 1 && unassigned.length === 1) {
    result.set(unassigned[0].participantId, [...openPositions][0]);
  }

  return result;
}

// 10명 전체 포지션 판정 (팀별로 나눠 처리)
function resolvePositions(players) {
  const result = new Map();
  for (const teamId of [100, 200]) {
    const teamResult = resolveTeamPositions(players.filter((p) => p.teamId === teamId));
    for (const [pid, pos] of teamResult) result.set(pid, pos);
  }
  return result;
}

// 후보 내전 match 중 최적 매칭 선택 (puuid 8/10 이상 일치, 시간 근접순)
function pickBestCandidate(rawPuuids, gameCreation, candidates) {
  const rawSet = new Set(rawPuuids);
  const gameTime = new Date(gameCreation).getTime();
  let best = null;
  let bestScore = null;
  for (const match of candidates) {
    const matchPuuids = [...match.team1, ...match.team2].map((entry) => entry[0]);
    const overlap = matchPuuids.filter((puuid) => rawSet.has(puuid)).length;
    if (overlap < MIN_PUUID_OVERLAP) continue;
    const matchTime = new Date(match.gameCreation || match.createdAt).getTime();
    const timeDiff = Math.abs(matchTime - gameTime);
    // 일치 수 우선, 동률이면 시간 근접순
    if (!best || overlap > bestScore.overlap || (overlap === bestScore.overlap && timeDiff < bestScore.timeDiff)) {
      best = match;
      bestScore = { overlap, timeDiff };
    }
  }
  return best;
}

// raw 1건을 내전 match와 매핑하고 match_player_stats 10행을 생성
async function mapRaw(raw) {
  const game = raw.rawJson;
  const players = extractPlayers(game);
  if (players.length !== 10 || players.some((p) => !p.puuid)) {
    return { mapped: false, reason: '참가자 정보 불완전' };
  }

  const gameTime = new Date(raw.gameCreation).getTime();
  const windowStart = new Date(gameTime - MATCH_TIME_WINDOW_MS);
  const windowEnd = new Date(gameTime + MATCH_TIME_WINDOW_MS);
  // 승패확정(gameCreation 기록)이 게임 종료보다 늦을 수 있어 createdAt 폴백은 +쪽을 넓게 잡음
  const candidates = await models.match.findAll({
    where: {
      groupId: raw.groupId,
      [Op.or]: [
        { gameCreation: { [Op.between]: [windowStart, windowEnd] } },
        {
          gameCreation: null,
          createdAt: { [Op.between]: [windowStart, new Date(gameTime + MATCH_TIME_WINDOW_MS * 2)] },
        },
      ],
    },
  });

  // 이미 다른 raw와 매핑된 match 제외 (같은 10인 연속 판을 1:1로 유지)
  const usedRows = await models.lcu_game_raw.findAll({
    where: {
      mappedMatchId: { [Op.in]: candidates.map((m) => m.gameId) },
      id: { [Op.ne]: raw.id },
    },
    attributes: ['mappedMatchId'],
    raw: true,
  });
  const usedMatchIds = new Set(usedRows.map((r) => r.mappedMatchId));
  const available = candidates.filter((m) => !usedMatchIds.has(m.gameId));

  const match = pickBestCandidate(players.map((p) => p.puuid), raw.gameCreation, available);
  if (!match) {
    return { mapped: false, reason: '일치하는 내전 기록 없음' };
  }

  const positions = resolvePositions(players);

  // 맞라인 상대 찾기 (반대 팀 같은 포지션)
  const byPosition = new Map(); // `${teamId}:${position}` → player
  for (const p of players) {
    const pos = positions.get(p.participantId);
    if (pos) byPosition.set(`${p.teamId}:${pos}`, p);
  }

  const rows = players.map((p) => {
    const pos = positions.get(p.participantId);
    const opponent = pos ? byPosition.get(`${p.teamId === 100 ? 200 : 100}:${pos}`) : null;
    return {
      matchId: match.gameId,
      riotGameKey: raw.riotGameKey,
      groupId: raw.groupId,
      seasonId: match.seasonId ?? null,
      puuid: p.puuid,
      position: pos,
      championId: p.championId,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      cs: p.cs,
      goldEarned: p.goldEarned,
      damageToChampions: p.damageToChampions,
      damageTaken: p.damageTaken,
      visionScore: p.visionScore,
      gameDurationSec: raw.gameDuration,
      win: p.win,
      laneOpponentPuuid: opponent ? opponent.puuid : null,
      csDiff: opponent ? p.cs - opponent.cs : null,
      goldDiff: opponent ? p.goldEarned - opponent.goldEarned : null,
      damageDiff: opponent ? p.damageToChampions - opponent.damageToChampions : null,
    };
  });

  await models.match_player_stat.bulkCreate(rows, { ignoreDuplicates: true });
  raw.mappedMatchId = match.gameId;
  await raw.save();

  return { mapped: true, matchId: match.gameId };
}

const GROUP_RESOLVE_MIN = 4; // 게임 참가자 10명 중 이 그룹 소속으로 등록된 인원이 이 이상이어야 그룹 확정

// 게임 참가자 puuid들이 가장 많이 속한 그룹을 판별 (무설정 자동 인식용)
async function resolveGroupFromPuuids(puuids) {
  const users = await models.user.findAll({
    where: { puuid: { [Op.in]: puuids } },
    attributes: ['groupId', 'puuid'],
    raw: true,
  });
  const counts = new Map();
  for (const u of users) counts.set(u.groupId, (counts.get(u.groupId) || 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [groupId, count] of counts) {
    if (count > bestCount) {
      best = groupId;
      bestCount = count;
    }
  }
  return bestCount >= GROUP_RESOLVE_MIN ? best : null;
}

// 업로드 수신: 참가자 검증 → 그룹 자동판별 → dedup → raw 저장 → 즉시 매핑
async function ingestGame({ uploaderPuuid, game }) {
  const riotGameKey = `${game.platformId}_${game.gameId}`;

  const puuids = (game.participantIdentities || [])
    .map((it) => it.player && it.player.puuid)
    .filter(Boolean);

  // 업로더가 실제 참가자여야 함 (기본 오용 방지)
  if (!puuids.includes(uploaderPuuid)) {
    return { status: 'rejected', reason: 'uploader_not_participant' };
  }

  const existing = await models.lcu_game_raw.findOne({ where: { riotGameKey } });
  if (existing) {
    return { status: 'duplicate', riotGameKey };
  }

  const groupId = await resolveGroupFromPuuids(puuids);
  if (!groupId) {
    return { status: 'skipped', reason: 'no_group', riotGameKey };
  }

  const bans = (game.teams || []).flatMap((t) =>
    (t.bans || []).map((b) => ({ championId: b.championId, teamId: t.teamId, pickTurn: b.pickTurn })),
  );

  const raw = await models.lcu_game_raw.create({
    riotGameKey,
    groupId,
    uploaderPuuid,
    gameCreation: new Date(game.gameCreation),
    gameDuration: game.gameDuration || 0,
    gameVersion: game.gameVersion || null,
    mapId: game.mapId || null,
    queueId: game.queueId || null,
    bansJson: bans,
    rawJson: game,
  });

  let mapResult = { mapped: false };
  try {
    mapResult = await mapRaw(raw);
  } catch (e) {
    logger.error(`[collector] 매핑 실패 (${riotGameKey}): ${e.message}`);
  }

  return {
    status: 'created',
    riotGameKey,
    groupId,
    mapped: mapResult.mapped,
    matchId: mapResult.matchId || null,
  };
}

// 미매핑 raw 재시도 (스케줄러용) — 승패확정이 업로드보다 늦은 경우를 회수
async function retryUnmappedRaws({ withinDays = 30 } = {}) {
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);
  const rows = await models.lcu_game_raw.findAll({
    where: { mappedMatchId: null, gameCreation: { [Op.gte]: since } },
  });
  let mapped = 0;
  for (const raw of rows) {
    try {
      const result = await mapRaw(raw);
      if (result.mapped) mapped += 1;
    } catch (e) {
      logger.error(`[collector] 재매핑 실패 (${raw.riotGameKey}): ${e.message}`);
    }
  }
  return { total: rows.length, mapped };
}

module.exports = {
  ingestGame,
  mapRaw,
  retryUnmappedRaws,
  resolveGroupFromPuuids,
  // 테스트용 순수 함수
  extractPlayers,
  resolveTeamPositions,
  resolvePositions,
  pickBestCandidate,
  QUEST_ITEM_POSITIONS,
};
