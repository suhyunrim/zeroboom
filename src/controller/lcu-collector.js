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
// 미확정 match(gameCreation null)의 createdAt 폴백 상한. 게임 몇 판을 몰아서 밤에
// 승패확정하는 운영 패턴이 실재해(그룹4 실측) 게임 시각 +24h까지 허용한다.
// puuid 8/10 일치가 강한 신호라 창을 넓혀도 오탐 위험은 낮다.
const FALLBACK_CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000;
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
      // 상세 지표 (op.gg식 표시용)
      item0: s.item0 ?? 0,
      item1: s.item1 ?? 0,
      item2: s.item2 ?? 0,
      item3: s.item3 ?? 0,
      item4: s.item4 ?? 0,
      item5: s.item5 ?? 0,
      item6: s.item6 ?? 0,
      runeKeystoneId: s.perk0 ?? null,
      runePrimaryStyleId: s.perkPrimaryStyle ?? null,
      runeSubStyleId: s.perkSubStyle ?? null,
      champLevel: s.champLevel ?? null,
      doubleKills: s.doubleKills ?? 0,
      tripleKills: s.tripleKills ?? 0,
      quadraKills: s.quadraKills ?? 0,
      pentaKills: s.pentaKills ?? 0,
      largestMultiKill: s.largestMultiKill ?? 0,
      largestKillingSpree: s.largestKillingSpree ?? 0,
      firstBloodKill: !!s.firstBloodKill,
      wardsPlaced: s.wardsPlaced ?? 0,
      wardsKilled: s.wardsKilled ?? 0,
      controlWardsBought: s.visionWardsBoughtInGame ?? 0,
    };
  });
}

// 팀 오브젝트 스탯 추출 (game.teams[] → match_team_stats 2행)
// LCU 원본의 firstDargon 오타를 firstDragon으로 정정해 저장한다.
function extractTeamRows({ raw, game, match }) {
  return (game.teams || []).map((t) => ({
    riotGameKey: raw.riotGameKey,
    groupId: raw.groupId,
    matchId: match ? match.gameId : null,
    teamNo: t.teamId === 100 ? 1 : 2,
    win: t.win === 'Win',
    baronKills: t.baronKills || 0,
    dragonKills: t.dragonKills || 0,
    riftHeraldKills: t.riftHeraldKills || 0,
    hordeKills: t.hordeKills || 0,
    towerKills: t.towerKills || 0,
    inhibitorKills: t.inhibitorKills || 0,
    firstBlood: !!t.firstBlood,
    firstTower: !!t.firstTower,
    firstDragon: !!t.firstDargon,
    firstBaron: !!t.firstBaron,
    firstInhibitor: !!t.firstInhibitor,
    bansJson: (t.bans || []).map((b) => ({ championId: b.championId, pickTurn: b.pickTurn })),
    gameVersion: raw.gameVersion || null,
  }));
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

// LCU가 주는 puuid는 UUID 형식(Riot 내부값)이라 우리 DB의 Riot API puuid와 직접 매칭 불가.
// 참가자의 gameName#tagLine(Riot ID)으로 summoners.name을 조회해 우리 DB puuid로 변환한다.
// 게임 원본엔 "게임 당시" 닉네임이 고정 기록되므로, 닉변 후 업로드된 판은 현재 이름으로
// 못 찾는다 → 닉네임 이력(summoner_name_histories)에서 게임 시각 당시 소유자를 폴백 조회.
// 그래도 미해결이면 LCU puuid 그대로 폴백 (게스트 행은 멤버 조회에서 자연히 제외됨).
// 반환: Map<participantId, dbPuuid>
async function resolveDbPuuids(players, gameTime = null) {
  const byPidRiotId = new Map();
  const riotIds = [];
  for (const p of players) {
    if (!p.gameName) continue;
    const riotId = `${p.gameName}#${p.tagLine}`;
    byPidRiotId.set(p.participantId, riotId);
    riotIds.push(riotId);
  }
  const rows = riotIds.length
    ? await models.summoner.findAll({
        where: { name: { [Op.in]: riotIds } },
        attributes: ['name', 'puuid'],
        raw: true,
      })
    : [];
  const puuidByRiotId = new Map(rows.map((r) => [r.name, r.puuid]));

  // 현재 이름으로 못 찾은 Riot ID → 닉네임 이력에서 "게임 당시 그 이름의 주인" 조회.
  // changedAt(감지 시각)까지 그 이름을 소유했으므로, gameTime보다 뒤에 변경된 것 중 가장 이른 행이 당시 주인.
  // gameTime 이전에 이미 버려진 이름이면 당시 주인을 알 수 없으므로 매칭하지 않는다(오연결 방지).
  const unresolved = riotIds.filter((id) => !puuidByRiotId.has(id));
  if (unresolved.length > 0) {
    const histRows = await models.summoner_name_history.findAll({
      where: { name: { [Op.in]: unresolved } },
      attributes: ['name', 'puuid', 'changedAt'],
      order: [['changedAt', 'ASC']],
      raw: true,
    });
    const gameMs = gameTime ? new Date(gameTime).getTime() : null;
    for (const h of histRows) {
      if (puuidByRiotId.has(h.name)) continue; // 이미 이른 changedAt으로 해결됨
      if (gameMs !== null && new Date(h.changedAt).getTime() <= gameMs) continue;
      puuidByRiotId.set(h.name, h.puuid);
    }
  }

  const result = new Map();
  for (const p of players) {
    const riotId = byPidRiotId.get(p.participantId);
    result.set(p.participantId, (riotId && puuidByRiotId.get(riotId)) || p.puuid);
  }
  return result;
}

// 부캐로 뛴 판을 본캐 통계에 합산하기 위해 그룹 내 부캐 puuid를 본캐(primaryPuuid)로 승격.
// 봇 match 로스터는 항상 본캐(부캐는 discordId null이라 인원뽑기에 안 잡힘)라 매핑 일관성도 확보된다.
// dbByPid: Map<participantId, dbPuuid> → 승격 적용된 새 Map 반환
async function promoteToPrimaryPuuids(groupId, dbByPid) {
  const puuids = [...new Set(dbByPid.values())];
  const subs = await models.user.findAll({
    where: { groupId, puuid: { [Op.in]: puuids }, primaryPuuid: { [Op.ne]: null } },
    attributes: ['puuid', 'primaryPuuid'],
    raw: true,
  });
  const primaryBySub = new Map(subs.map((u) => [u.puuid, u.primaryPuuid]));
  const result = new Map();
  for (const [pid, puuid] of dbByPid) result.set(pid, primaryBySub.get(puuid) || puuid);
  return result;
}

// gameCreation 근접 + puuid 8/10 일치로 봇 생성 내전 match 후보를 찾는다 (없으면 null).
async function findBotMatch(raw, dbPuuids) {
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
          createdAt: { [Op.between]: [windowStart, new Date(gameTime + FALLBACK_CONFIRM_WINDOW_MS)] },
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

  return pickBestCandidate(dbPuuids, raw.gameCreation, available);
}

// 승리한 내전 팀 도출 (승리팀 전원 win=true) → 자동 승패확정에 사용
function deriveWinTeam(match, rows) {
  const team1Puuids = new Set(match.team1.map((entry) => entry[0]));
  const team1Wins = rows.filter((r) => team1Puuids.has(r.puuid) && r.win).length;
  const team2Wins = rows.filter((r) => !team1Puuids.has(r.puuid) && r.win).length;
  if (team1Wins > team2Wins) return 1;
  if (team2Wins > team1Wins) return 2;
  return null;
}

// 참가자 10명 → match_player_stats 10행 구성. puuid는 우리 DB puuid(dbByPid) 기준.
// match가 있으면 matchId/seasonId 채움, 없으면 null (수동 커스텀).
function buildStatRows({ raw, players, dbByPid, positions, match }) {
  const puuidOf = (p) => dbByPid.get(p.participantId);
  // 맞라인 상대 찾기 (반대 팀 같은 포지션)
  const byPosition = new Map(); // `${teamId}:${position}` → player
  for (const p of players) {
    const pos = positions.get(p.participantId);
    if (pos) byPosition.set(`${p.teamId}:${pos}`, p);
  }
  return players.map((p) => {
    const pos = positions.get(p.participantId);
    const opponent = pos ? byPosition.get(`${p.teamId === 100 ? 200 : 100}:${pos}`) : null;
    return {
      matchId: match ? match.gameId : null,
      riotGameKey: raw.riotGameKey,
      groupId: raw.groupId,
      seasonId: match ? (match.seasonId ?? null) : null,
      puuid: puuidOf(p),
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
      laneOpponentPuuid: opponent ? puuidOf(opponent) : null,
      csDiff: opponent ? p.cs - opponent.cs : null,
      goldDiff: opponent ? p.goldEarned - opponent.goldEarned : null,
      damageDiff: opponent ? p.damageToChampions - opponent.damageToChampions : null,
      // 상세 지표
      teamNo: p.teamId === 100 ? 1 : 2,
      item0: p.item0,
      item1: p.item1,
      item2: p.item2,
      item3: p.item3,
      item4: p.item4,
      item5: p.item5,
      item6: p.item6,
      spell1Id: p.spell1Id,
      spell2Id: p.spell2Id,
      runeKeystoneId: p.runeKeystoneId,
      runePrimaryStyleId: p.runePrimaryStyleId,
      runeSubStyleId: p.runeSubStyleId,
      champLevel: p.champLevel,
      doubleKills: p.doubleKills,
      tripleKills: p.tripleKills,
      quadraKills: p.quadraKills,
      pentaKills: p.pentaKills,
      largestMultiKill: p.largestMultiKill,
      largestKillingSpree: p.largestKillingSpree,
      firstBloodKill: p.firstBloodKill,
      wardsPlaced: p.wardsPlaced,
      wardsKilled: p.wardsKilled,
      controlWardsBought: p.controlWardsBought,
    };
  });
}

// raw 1건 → match_player_stats 10행 생성(항상). 봇 match가 있으면 매핑까지(best-effort).
// 커스텀이면 봇 match 유무와 무관하게 통계를 만든다.
async function processRaw(raw) {
  const game = raw.rawJson;
  const players = extractPlayers(game);
  if (players.length !== 10 || players.some((p) => !p.puuid)) {
    return { statsCreated: false, mapped: false, reason: '참가자 정보 불완전' };
  }

  const resolved = await resolveDbPuuids(players, raw.gameCreation);
  const dbByPid = await promoteToPrimaryPuuids(raw.groupId, resolved);
  const positions = resolvePositions(players);
  const dbPuuids = players.map((p) => dbByPid.get(p.participantId));
  const match = await findBotMatch(raw, dbPuuids);

  const rows = buildStatRows({ raw, players, dbByPid, positions, match });
  await models.match_player_stat.bulkCreate(rows, { ignoreDuplicates: true });
  await models.match_team_stat.bulkCreate(extractTeamRows({ raw, game, match }), { ignoreDuplicates: true });

  raw.statsProcessedAt = new Date();
  let winTeam = null;
  if (match) {
    raw.mappedMatchId = match.gameId;
    winTeam = deriveWinTeam(match, rows);
  }
  await raw.save();

  return { statsCreated: true, mapped: !!match, matchId: match ? match.gameId : null, winTeam };
}

// 이미 통계가 있는 raw를 봇 match에 뒤늦게 매핑 (승패확정이 업로드보다 늦은 경우 회수).
// 통계 재생성/puuid 재조회 없이 매핑만 시도한다.
async function remapRaw(raw) {
  if (raw.mappedMatchId) return { mapped: false };
  const statRows = await models.match_player_stat.findAll({
    where: { riotGameKey: raw.riotGameKey },
    attributes: ['puuid', 'win'],
    raw: true,
  });
  if (statRows.length === 0) return { mapped: false };

  const match = await findBotMatch(raw, statRows.map((r) => r.puuid));
  if (!match) return { mapped: false };

  await models.match_player_stat.update(
    { matchId: match.gameId, seasonId: match.seasonId ?? null },
    { where: { riotGameKey: raw.riotGameKey } },
  );
  await models.match_team_stat.update(
    { matchId: match.gameId },
    { where: { riotGameKey: raw.riotGameKey } },
  );
  raw.mappedMatchId = match.gameId;
  await raw.save();

  return { mapped: true, matchId: match.gameId, winTeam: deriveWinTeam(match, statRows) };
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

// 업로드 수신: 참가자 검증 → Riot ID로 그룹 자동판별 → dedup → raw 저장 → 통계 생성(+매핑)
async function ingestGame({ uploaderPuuid, game }) {
  const riotGameKey = `${game.platformId}_${game.gameId}`;

  // 업로더가 실제 참가자여야 함 (LCU puuid 공간에서 비교, 기본 오용 방지)
  const lcuPuuids = (game.participantIdentities || [])
    .map((it) => it.player && it.player.puuid)
    .filter(Boolean);
  if (!lcuPuuids.includes(uploaderPuuid)) {
    return { status: 'rejected', reason: 'uploader_not_participant' };
  }

  const existing = await models.lcu_game_raw.findOne({ where: { riotGameKey } });
  if (existing) {
    return { status: 'duplicate', riotGameKey };
  }

  // Riot ID(gameName#tagLine)로 우리 DB puuid를 조회한 뒤 그룹 판별
  const players = extractPlayers(game);
  const dbByPid = await resolveDbPuuids(players, game.gameCreation);
  const groupId = await resolveGroupFromPuuids([...dbByPid.values()]);
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

  let result = { statsCreated: false, mapped: false };
  try {
    result = await processRaw(raw);
  } catch (e) {
    logger.error(`[collector] 통계 생성 실패 (${riotGameKey}): ${e.message}`);
  }

  return {
    status: 'created',
    riotGameKey,
    groupId,
    statsCreated: result.statsCreated,
    mapped: result.mapped,
    matchId: result.matchId || null,
    winTeam: result.winTeam ?? null,
  };
}

// 미처리/미매핑 raw 재시도 (스케줄러용).
// (1) 통계 미생성 raw → 생성 재시도, (2) 통계는 있으나 봇 match 미매핑 raw → 매핑만 재시도
//     (승패확정이 헬퍼 업로드보다 늦게 이뤄진 판을 회수)
// onMapped: 새로 매핑된 건마다 호출 (자동 승패확정 트리거용)
async function retryUnmappedRaws({ withinDays = 30, onMapped = null } = {}) {
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);
  const fireMapped = async (result) => {
    if (!result.mapped) return false;
    if (onMapped) {
      await onMapped({ gameId: result.matchId, winTeam: result.winTeam }).catch((e) =>
        logger.error(`[collector] 자동 승패확정 실패 (${result.matchId}): ${e.message}`),
      );
    }
    return true;
  };

  let mapped = 0;

  const unprocessed = await models.lcu_game_raw.findAll({
    where: { statsProcessedAt: null, gameCreation: { [Op.gte]: since } },
  });
  for (const raw of unprocessed) {
    try {
      if (await fireMapped(await processRaw(raw))) mapped += 1;
    } catch (e) {
      logger.error(`[collector] 통계 생성 재시도 실패 (${raw.riotGameKey}): ${e.message}`);
    }
  }

  const unmapped = await models.lcu_game_raw.findAll({
    where: {
      statsProcessedAt: { [Op.ne]: null },
      mappedMatchId: null,
      gameCreation: { [Op.gte]: since },
    },
  });
  for (const raw of unmapped) {
    try {
      if (await fireMapped(await remapRaw(raw))) mapped += 1;
    } catch (e) {
      logger.error(`[collector] 재매핑 실패 (${raw.riotGameKey}): ${e.message}`);
    }
  }

  return { total: unprocessed.length + unmapped.length, mapped };
}

// LCU 폴백 puuid(36자)로 저장된 스탯 치유 (스케줄러용).
// 닉변 직후 업로드돼 브릿지에 실패한 판을, 새벽 배치가 summoners.name/닉네임 이력을 갱신한 뒤
// 재처리해 정식 puuid로 복구한다. 미등록 부캐/외부 용병 판은 매번 다시 시도되지만
// 수량이 작아(게임 단위) 비용은 무시 가능.
async function healUnbridgedStats({ withinDays = 14, onMapped = null } = {}) {
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);
  const raws = await models.lcu_game_raw.findAll({
    where: { statsProcessedAt: { [Op.ne]: null }, gameCreation: { [Op.gte]: since } },
  });
  if (raws.length === 0) return { checked: 0, healed: 0 };

  const statRows = await models.match_player_stat.findAll({
    where: { riotGameKey: { [Op.in]: raws.map((r) => r.riotGameKey) } },
    attributes: ['riotGameKey', 'puuid'],
    raw: true,
  });
  // LCU puuid는 UUID(36자), 정식 puuid는 78자 — 길이로 폴백 행 식별
  const unbridgedKeys = new Set(
    statRows.filter((r) => r.puuid && r.puuid.length < 50).map((r) => r.riotGameKey),
  );

  let healed = 0;
  for (const raw of raws) {
    if (!unbridgedKeys.has(raw.riotGameKey)) continue;
    try {
      await models.match_player_stat.destroy({ where: { riotGameKey: raw.riotGameKey } });
      await models.match_team_stat.destroy({ where: { riotGameKey: raw.riotGameKey } });
      const result = await processRaw(raw);
      healed += 1;
      if (result.mapped && result.winTeam && onMapped) {
        await onMapped({ gameId: result.matchId, winTeam: result.winTeam }).catch((e) =>
          logger.error(`[collector] 치유 후 자동 승패확정 실패 (${result.matchId}): ${e.message}`),
        );
      }
    } catch (e) {
      logger.error(`[collector] 스탯 치유 실패 (${raw.riotGameKey}): ${e.message}`);
    }
  }
  return { checked: unbridgedKeys.size, healed };
}

module.exports = {
  ingestGame,
  processRaw,
  remapRaw,
  retryUnmappedRaws,
  healUnbridgedStats,
  resolveGroupFromPuuids,
  resolveDbPuuids,
  promoteToPrimaryPuuids,
  // 테스트용 순수 함수
  extractPlayers,
  extractTeamRows,
  resolveTeamPositions,
  resolvePositions,
  pickBestCandidate,
  deriveWinTeam,
  QUEST_ITEM_POSITIONS,
};
