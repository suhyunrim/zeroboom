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
// gameCreation이 아직 없는 match(플랜만 만들어진 상태)는 createdAt으로 비교하되, 게임을 먼저 하고
// 나중에 match를 만들어 기록하는 사후 등록이 있어 +쪽을 넓게 잡는다(실측 최대 14.7시간).
// 넓혀도 오탐이 낮은 근거: 서로 다른 세션에서 같은 10명이 같은 5:5로 다시 나뉜 사례가
// 그룹4 1005판 중 4건뿐이고 그중 24시간 안은 1건이며, 그마저 사후 생성 플랜 페널티가 거른다.
const FALLBACK_CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_PUUID_OVERLAP = 8; // 10명 중 8명 이상 일치해야 같은 판으로 인정
// 연속 판(3판 2선승 등)을 미리 만들어둔 플랜은 생성 시각이 몇 초밖에 차이나지 않는다(실측 2~8초).
// 이 차이 안의 후보들은 시간 근접도로 우열을 가리지 않고 생성 순서로 판정한다.
const PLAN_TIE_WINDOW_MS = 30 * 1000;
// 게임이 시작된 뒤에 만들어진 플랜은 그 게임의 플랜일 수 없다(플랜 → 게임 순서).
// 다만 게임을 먼저 하고 사후에 기록하는 경우가 있어 제외하지는 않고, 한 판 길이만큼 불이익을 준다.
// 이 값이 있어야 "1승 1패 후 추가한 3판째 플랜"이 앞선 게임을 가져가지 않는다.
const POST_GAME_PLAN_PENALTY_MS = 30 * 60 * 1000;

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

// extractPlayers가 뽑는 상세 지표 중 match_player_stats 컬럼과 이름이 1:1인 필드.
// buildStatRows가 이 목록으로 전개하므로, 지표를 추가할 땐 extractPlayers와 여기만 맞추면 된다.
const DETAIL_STAT_FIELDS = [
  'item0', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6',
  'spell1Id', 'spell2Id',
  'runeKeystoneId', 'runePrimaryStyleId', 'runeSubStyleId',
  'champLevel',
  'doubleKills', 'tripleKills', 'quadraKills', 'pentaKills', 'largestMultiKill', 'largestKillingSpree',
  'firstBloodKill', 'wardsPlaced', 'wardsKilled', 'controlWardsBought',
];

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

// 매치 플랜의 팀 편성이 실제 인게임 편성과 얼마나 일치하는지 (일치한 인원 수).
// 같은 10명으로 만든 다른 플랜(선택되지 않고 버려진 플랜 등)을 구분하는 데 쓴다.
function teamAgreement(match, sideByPuuid) {
  const sidesOf = (entries) => entries.map((e) => sideByPuuid.get(e[0])).filter((s) => s != null);
  const t1 = sidesOf(match.team1);
  const t2 = sidesOf(match.team2);
  const sides = [...new Set([...t1, ...t2])];
  if (sides.length < 2) return 0; // 한 진영만 매핑됨 → 편성 비교 불가
  const [a, b] = sides;
  const agree = (x, y) => t1.filter((s) => s === x).length + t2.filter((s) => s === y).length;
  return Math.max(agree(a, b), agree(b, a)); // team1↔블루/레드 두 방향 중 잘 맞는 쪽
}

// 후보 내전 match 중 최적 매칭 선택.
// sideByPuuid: Map<우리 DB puuid, 인게임 진영> — 참가자 일치(8/10)와 팀 편성 일치를 함께 본다.
function pickBestCandidate(sideByPuuid, gameCreation, candidates) {
  const gameTime = new Date(gameCreation).getTime();
  const scored = [];
  for (const match of candidates) {
    const matchPuuids = [...match.team1, ...match.team2].map((entry) => entry[0]);
    const overlap = matchPuuids.filter((puuid) => sideByPuuid.has(puuid)).length;
    if (overlap < MIN_PUUID_OVERLAP) continue;
    const matchTime = new Date(match.gameCreation || match.createdAt).getTime();
    // 게임 시작 후에 만들어진 플랜은 사후 기록 가능성만 남기고 뒤로 미룬다
    const createdAfterGame = new Date(match.createdAt).getTime() > gameTime;
    scored.push({
      match,
      overlap,
      agreement: teamAgreement(match, sideByPuuid),
      timeDiff: Math.abs(matchTime - gameTime) + (createdAfterGame ? POST_GAME_PLAN_PENALTY_MS : 0),
    });
  }
  if (scored.length === 0) return null;

  // 참가자 일치 → 팀 편성 일치 순으로 최선만 남긴다 (편성이 다른 플랜 = 선택되지 않고 버려진 플랜)
  const bestOverlap = Math.max(...scored.map((s) => s.overlap));
  let pool = scored.filter((s) => s.overlap === bestOverlap);
  const bestAgreement = Math.max(...pool.map((s) => s.agreement));
  pool = pool.filter((s) => s.agreement === bestAgreement);

  // 가장 가까운 플랜과 사실상 동시에 만들어진 것들끼리는 시간으로 우열을 가릴 수 없으므로
  // 생성 순서를 따른다 (먼저 만든 플랜 = 먼저 한 게임).
  const minDiff = Math.min(...pool.map((s) => s.timeDiff));
  const tied = pool.filter((s) => s.timeDiff - minDiff <= PLAN_TIE_WINDOW_MS);
  return tied.reduce((a, b) => (a.match.gameId <= b.match.gameId ? a : b)).match;
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

const SCRIM_TEAM_MIN_OVERLAP = 4; // 한 팀 5인 중 대회 팀 멤버가 이 이상이면 스크림 (부캐/용병 1명 허용)

// 스크림(대회 팀 연습) 감지: 진행 중(미종료) 대회 팀 로스터와 인게임 양 팀을 각각 대조.
// 실측(7차 CK 20게임)에서 4/5 기준으로 전건 정확 분류됨.
// 반환: { tournamentId, versus: { blueTeamId, redTeamId } | null } | null
// versus는 양측이 같은 대회의 서로 다른 팀일 때만 채워짐 (팀vs팀 정식 스크림 → 자동 기록 대상)
async function detectScrim(groupId, players, dbByPid) {
  const tournaments = await models.tournament.findAll({
    where: { groupId, status: { [Op.ne]: 'finished' } },
    attributes: ['id', 'status'],
    raw: true,
  });
  if (tournaments.length === 0) return null;
  const statusById = new Map(tournaments.map((t) => [t.id, t.status]));

  const teams = await models.tournament_team.findAll({
    where: { tournamentId: { [Op.in]: tournaments.map((t) => t.id) } },
    attributes: ['id', 'tournamentId', 'members'],
    raw: true,
  });
  const bestBySide = {}; // 100/200 → { teamId, tournamentId, overlap } | null
  for (const sideId of [100, 200]) {
    const puuids = players.filter((p) => p.teamId === sideId).map((p) => dbByPid.get(p.participantId));
    let best = null;
    for (const t of teams) {
      const members = typeof t.members === 'string' ? JSON.parse(t.members) : t.members || [];
      const memberSet = new Set(members.map((m) => m.puuid));
      const overlap = puuids.filter((p) => memberSet.has(p)).length;
      if (overlap >= SCRIM_TEAM_MIN_OVERLAP && (!best || overlap > best.overlap)) {
        best = { teamId: t.id, tournamentId: t.tournamentId, overlap };
      }
    }
    bestBySide[sideId] = best;
  }

  const blue = bestBySide[100];
  const red = bestBySide[200];
  if (!blue && !red) return null;
  const versus =
    blue && red && blue.tournamentId === red.tournamentId && blue.teamId !== red.teamId
      ? { blueTeamId: blue.teamId, redTeamId: red.teamId }
      : null;
  const tournamentId = (blue || red).tournamentId;
  return { tournamentId, tournamentStatus: statusById.get(tournamentId), versus };
}

// 팀vs팀 스크림을 tournament_scrims에 자동 기록 (게임당 1행, 승자 1:0).
// riotGameKey unique로 멱등 — 백필/치유 재처리 시 중복 기록되지 않는다.
const SCRIM_MANUAL_DUP_WINDOW_MS = 24 * 60 * 60 * 1000;
// 대진표 매치 예정 시각 ±이 범위 안의 게임은 본선 경기로 본다 (Bo3 최대 ~3h + 시작 지연 여유)
const BRACKET_MATCH_WINDOW_MS = 6 * 60 * 60 * 1000;

async function recordScrimResult({ raw, game, scrim }) {
  const existing = await models.tournament_scrim.findOne({ where: { riotGameKey: raw.riotGameKey } });
  if (existing) return;
  const gameTime = new Date(raw.gameCreation).getTime();

  // 본선 경기 오인 방지: 감지된 팀 쌍이 대진표에 있으면 경기 예정 시각으로 본선/스크림을 가른다.
  // 실측(7차 CK): 본선 4게임이 스크림으로 오기록돼 AI 예측 팩터를 오염시켰고, 대회는 대진표를
  // 며칠에 걸쳐 소화(rolling)하므로 heldAt은 기준이 못 된다 — 매치별 scheduledAt이 정답.
  // - 예정 시각 ±6h 이내 → 본선 (기록 안 함)
  // - 예정 시각이 전부 있고 전부 멀다 → 상대팀끼리의 연습 → 스크림 (기록)
  // - 예정 시각 없는 매치가 있다 → 구분 불가 → 틀린 기록보다 빈 기록이 낫다 (생략)
  const bracketPairs = await models.tournament_match.findAll({
    where: {
      tournamentId: scrim.tournamentId,
      [Op.or]: [
        { team1Id: scrim.versus.blueTeamId, team2Id: scrim.versus.redTeamId },
        { team1Id: scrim.versus.redTeamId, team2Id: scrim.versus.blueTeamId },
      ],
    },
    raw: true,
  });
  if (bracketPairs.length > 0) {
    const nearSchedule = bracketPairs.some(
      (m) => m.scheduledAt && Math.abs(new Date(m.scheduledAt).getTime() - gameTime) <= BRACKET_MATCH_WINDOW_MS,
    );
    const allScheduled = bracketPairs.every((m) => m.scheduledAt);
    if (nearSchedule || !allScheduled) {
      logger.info(
        `[collector] 스크림 자동 기록 생략 (${raw.riotGameKey}): 대진표 팀쌍 — ${
          nearSchedule ? '예정 시각 근접(본선 경기)' : '예정 시각 미설정(구분 불가)'
        }`,
      );
      return;
    }
  }

  // 같은 팀쌍의 수동 기록이 게임 시각 ±24h 내(입력 시점 기준)에 있으면 팀장이 이미 올린
  // 세트로 보고 기록하지 않는다 — 수동 기록이 있으면 수동이 정본. 소급 업로드(과거 스크림이
  // 뒤늦게 수집)돼도 기존 수동 기록과 이중 카운트되지 않게 하는 방어선.
  const manualRows = await models.tournament_scrim.findAll({
    where: {
      tournamentId: scrim.tournamentId,
      recordedByDiscordId: { [Op.ne]: 'collector' },
      [Op.or]: [
        { team1Id: scrim.versus.blueTeamId, team2Id: scrim.versus.redTeamId },
        { team1Id: scrim.versus.redTeamId, team2Id: scrim.versus.blueTeamId },
      ],
    },
  });
  const manualNearby = manualRows.find(
    (s) => Math.abs(new Date(s.createdAt).getTime() - gameTime) <= SCRIM_MANUAL_DUP_WINDOW_MS,
  );
  if (manualNearby) {
    logger.info(
      `[collector] 스크림 자동 기록 생략 (${raw.riotGameKey}): 같은 팀쌍 수동 기록 존재 (scrimId=${manualNearby.id})`,
    );
    return;
  }
  const blueWin = (game.teams || []).some((t) => t.teamId === 100 && t.win === 'Win');
  await models.tournament_scrim.create({
    tournamentId: scrim.tournamentId,
    team1Id: scrim.versus.blueTeamId,
    team2Id: scrim.versus.redTeamId,
    team1Score: blueWin ? 1 : 0,
    team2Score: blueWin ? 0 : 1,
    recordedByDiscordId: 'collector', // 수집기 자동 기록 표식
    riotGameKey: raw.riotGameKey,
  });
}

// gameCreation 근접 + puuid 8/10 일치로 봇 생성 내전 match 후보를 찾는다 (없으면 null).
// sideByPuuid: Map<우리 DB puuid, 인게임 진영>
async function findBotMatch(raw, sideByPuuid) {
  const gameTime = new Date(raw.gameCreation).getTime();
  const windowStart = new Date(gameTime - MATCH_TIME_WINDOW_MS);
  const windowEnd = new Date(gameTime + MATCH_TIME_WINDOW_MS);
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

  return pickBestCandidate(sideByPuuid, raw.gameCreation, available);
}

// 매핑된 match에 실제 게임 시각을 남긴다. match는 플랜 생성 시각(createdAt)만 갖고 있어
// 2연전이 같은 시각으로 뭉치거나 사후 기록이 엉뚱한 시점에 표시되는데, 수집으로 알게 된
// 진짜 시각을 채워 표시와 이후 매핑 판정을 함께 바로잡는다. 이미 있으면 덮어쓰지 않는다.
async function stampGameCreation(match, raw) {
  if (match.gameCreation) return;
  await match.update({ gameCreation: raw.gameCreation });
}

// 승리한 내전 팀 도출 → 자동 승패확정에 사용.
// 승자가 양 팀에 걸쳐 있으면 플랜과 실제 편성이 다른 것이므로 판정하지 않는다(수동 확정에 맡김).
function deriveWinTeam(match, rows) {
  const team1Puuids = new Set(match.team1.map((entry) => entry[0]));
  const team1Wins = rows.filter((r) => team1Puuids.has(r.puuid) && r.win).length;
  const team2Wins = rows.filter((r) => !team1Puuids.has(r.puuid) && r.win).length;
  if (team1Wins > 0 && team2Wins > 0) return null;
  if (team1Wins > 0) return 1;
  if (team2Wins > 0) return 2;
  return null;
}

// 참가자 10명 → match_player_stats 10행 구성. puuid는 우리 DB puuid(dbByPid) 기준.
// match가 있으면 matchId/seasonId 채움, 없으면 null (수동 커스텀).
function buildStatRows({ raw, players, dbByPid, positions, match, isScrim = false }) {
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
      // 상세 지표 (extractPlayers 출력 필드명 = DB 컬럼명 1:1)
      teamNo: p.teamId === 100 ? 1 : 2,
      ...Object.fromEntries(DETAIL_STAT_FIELDS.map((f) => [f, p[f]])),
      isScrim,
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
  const sideByPuuid = new Map(players.map((p) => [dbByPid.get(p.participantId), p.teamId]));
  const match = await findBotMatch(raw, sideByPuuid);

  // 봇 match와 매핑되면 정규 내전, 아니면 스크림(대회 팀 연습) 여부 판정
  const scrim = match ? null : await detectScrim(raw.groupId, players, dbByPid);

  const rows = buildStatRows({ raw, players, dbByPid, positions, match, isScrim: !!scrim });
  await models.match_player_stat.bulkCreate(rows, { ignoreDuplicates: true });
  await models.match_team_stat.bulkCreate(extractTeamRows({ raw, game, match }), { ignoreDuplicates: true });

  // 팀vs팀 스크림이면 대회 스크림 전적(AI 예측·대진표 상대전적)에 자동 반영.
  // 수동 기록과 동일하게 in_progress 대회만 — preparing은 팀이 재편될 수 있어 기록하지 않는다(태깅만).
  if (scrim && scrim.versus && scrim.tournamentStatus === 'in_progress') {
    try {
      await recordScrimResult({ raw, game, scrim });
    } catch (e) {
      logger.error(`[collector] 스크림 자동 기록 실패 (${raw.riotGameKey}): ${e.message}`);
    }
  }

  raw.statsProcessedAt = new Date();
  raw.isScrim = !!scrim;
  raw.scrimTournamentId = scrim ? scrim.tournamentId : null;
  let winTeam = null;
  if (match) {
    raw.mappedMatchId = match.gameId;
    winTeam = deriveWinTeam(match, rows);
    await stampGameCreation(match, raw);
  }
  await raw.save();

  return { statsCreated: true, mapped: !!match, isScrim: !!scrim, matchId: match ? match.gameId : null, winTeam };
}

// 이미 통계가 있는 raw를 봇 match에 뒤늦게 매핑 (승패확정이 업로드보다 늦은 경우 회수).
// 통계 재생성/puuid 재조회 없이 매핑만 시도한다.
async function remapRaw(raw) {
  if (raw.mappedMatchId) return { mapped: false };
  const statRows = await models.match_player_stat.findAll({
    where: { riotGameKey: raw.riotGameKey },
    attributes: ['puuid', 'win', 'teamNo'],
    raw: true,
  });
  if (statRows.length === 0) return { mapped: false };

  const match = await findBotMatch(raw, new Map(statRows.map((r) => [r.puuid, r.teamNo])));
  if (!match) return { mapped: false };

  // 뒤늦게 봇 match와 매핑됨 = 매칭생성 거친 정규 내전 → 스크림 태그 해제
  await models.match_player_stat.update(
    { matchId: match.gameId, seasonId: match.seasonId ?? null, isScrim: false },
    { where: { riotGameKey: raw.riotGameKey } },
  );
  await models.match_team_stat.update(
    { matchId: match.gameId },
    { where: { riotGameKey: raw.riotGameKey } },
  );
  raw.mappedMatchId = match.gameId;
  raw.isScrim = false;
  raw.scrimTournamentId = null;
  await stampGameCreation(match, raw);
  await raw.save();
  // 스크림으로 잘못 자동 기록됐던 전적도 회수
  await models.tournament_scrim.destroy({ where: { riotGameKey: raw.riotGameKey } });

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

// 실시간 수집(elise) 페이로드 검증 — 헬퍼가 명단·시각으로 대조해 보내지만 서버도 독립 확인한다.
// 엉뚱한 판의 기록이 붙으면 되돌리기 어려우므로, 애매하면 저장하지 않는다(null).
const LIVE_MAX_TICKS = 500; // 30초 간격 → 정상 게임이면 100개 미만
const LIVE_MIN_ROSTER_OVERLAP = 8; // 10명 중
// 챔프 셀렉트는 상대 팀 puuid가 가려질 수 있어(커스텀에서 실제 가려지는지는 미확인) 내 팀 5명 기준으로 느슨하게
const CHAMP_SELECT_MIN_OVERLAP = 4;

function verifyLive(live, game) {
  if (!live || !Array.isArray(live.ticks) || !Array.isArray(live.events)) return null;
  if (live.ticks.length > LIVE_MAX_TICKS) return null;
  const gameRiotIds = new Set(
    (game.participantIdentities || [])
      .map((it) => it.player && `${it.player.gameName}#${it.player.tagLine}`)
      .filter(Boolean),
  );
  const overlap = (live.roster || []).filter((name) => gameRiotIds.has(name)).length;
  return overlap >= LIVE_MIN_ROSTER_OVERLAP ? live : null;
}

function verifyChampSelect(champSelect, game) {
  if (!champSelect || !Array.isArray(champSelect.actions) || champSelect.actions.length === 0) return null;
  const gamePuuids = new Set(
    (game.participantIdentities || []).map((it) => it.player && it.player.puuid).filter(Boolean),
  );
  const overlap = (champSelect.puuids || []).filter((p) => gamePuuids.has(p)).length;
  return overlap >= CHAMP_SELECT_MIN_OVERLAP ? champSelect : null;
}

function buildLiveTimelinePayload(verifiedLive) {
  return {
    capturedAt: verifiedLive.capturedAt,
    durationSec: verifiedLive.durationSec,
    partial: verifiedLive.partial, // 게임 도중 켜져 곡선이 반쪽인 판
    gameMode: verifiedLive.gameMode,
    mapTerrain: verifiedLive.mapTerrain, // 용 영혼 지형
    static: verifiedLive.static,
    ticks: verifiedLive.ticks,
    // self(골드·스킬레벨)는 Live API가 본인 것만 주는 비대칭 데이터 —
    // 켠 사람만 기록이 생기므로 통계·표시에 쓰지 말고 보관만 한다.
    self: verifiedLive.self,
    selfRiotId: verifiedLive.selfRiotId,
  };
}

// 중복 업로드에서 기존 raw의 빈 실시간 필드만 채운다 (덮어쓰지 않음).
// 먼저 올린 참가자에게 live가 없고 뒤에 올린 참가자에게 있는 경우의 유실 방지.
async function backfillLiveData(existing, { live, champSelect, game }) {
  const merged = [];
  if (!existing.liveEventsJson && !existing.liveTimelineJson) {
    const verifiedLive = verifyLive(live, game);
    if (verifiedLive) {
      existing.liveEventsJson = verifiedLive.events;
      existing.liveTimelineJson = buildLiveTimelinePayload(verifiedLive);
      merged.push('live');
    }
  }
  if (!existing.champSelectJson) {
    const verifiedChampSelect = verifyChampSelect(champSelect, game);
    if (verifiedChampSelect) {
      existing.champSelectJson = verifiedChampSelect;
      merged.push('champSelect');
    }
  }
  if (merged.length) {
    await existing.save();
    logger.info(`[collector] 중복 업로드에서 실시간 데이터 보강 (${existing.riotGameKey}: ${merged.join(', ')})`);
  }
  return merged;
}

// 업로드 수신: 참가자 검증 → Riot ID로 그룹 자동판별 → dedup → raw 저장 → 통계 생성(+매핑)
// live/champSelect는 게임 도중 elise가 켜져 있던 판에만 실려 온다 (대부분 null).
async function ingestGame({ uploaderPuuid, game, live = null, champSelect = null }) {
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
    const merged = await backfillLiveData(existing, { live, champSelect, game });
    return { status: 'duplicate', riotGameKey, groupId: existing.groupId, merged };
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

  // 실시간 수집 원본은 검증을 통과한 것만 보관 (실패해도 업로드 자체는 성공 — 게임 원본이 본체)
  const verifiedLive = verifyLive(live, game);
  const verifiedChampSelect = verifyChampSelect(champSelect, game);
  if (live && !verifiedLive) logger.info(`[collector] 실시간 데이터 검증 실패로 미저장 (${riotGameKey})`);
  if (champSelect && !verifiedChampSelect) {
    logger.info(`[collector] 챔프 셀렉트 검증 실패로 미저장 (${riotGameKey})`);
  }

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
    liveEventsJson: verifiedLive ? verifiedLive.events : null,
    liveTimelineJson: verifiedLive ? buildLiveTimelinePayload(verifiedLive) : null,
    champSelectJson: verifiedChampSelect,
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

// 매핑 성공 시 자동 승패확정 콜백 발화. 실패는 로그만 남기고 배치를 계속한다.
// (winTeam 검증은 콜백(autoConfirmMatchWin)이 담당 — 호출부에서 중복 검사하지 않는다)
async function fireOnMapped(onMapped, result) {
  if (!result.mapped) return false;
  if (onMapped) {
    await onMapped({ gameId: result.matchId, winTeam: result.winTeam }).catch((e) =>
      logger.error(`[collector] 자동 승패확정 실패 (${result.matchId}): ${e.message}`),
    );
  }
  return true;
}

// 미처리/미매핑 raw 재시도 (스케줄러용).
// (1) 통계 미생성 raw → 생성 재시도, (2) 통계는 있으나 봇 match 미매핑 raw → 매핑만 재시도
//     (승패확정이 헬퍼 업로드보다 늦게 이뤄진 판을 회수)
// onMapped: 새로 매핑된 건마다 호출 (자동 승패확정 트리거용)
async function retryUnmappedRaws({ withinDays = 30, onMapped = null } = {}) {
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);

  let mapped = 0;

  // 게임 시각 순으로 처리해야 연속 판이 플랜 생성 순서대로 배정된다
  // (업로드 순서는 헬퍼가 스캔한 순서라 게임 순서와 다를 수 있다)
  const unprocessed = await models.lcu_game_raw.findAll({
    where: { statsProcessedAt: null, gameCreation: { [Op.gte]: since } },
    order: [['gameCreation', 'ASC']],
  });
  for (const raw of unprocessed) {
    try {
      if (await fireOnMapped(onMapped, await processRaw(raw))) mapped += 1;
    } catch (e) {
      logger.error(`[collector] 통계 생성 재시도 실패 (${raw.riotGameKey}): ${e.message}`);
    }
  }

  // remapRaw는 rawJson(게임당 수백 KB)을 쓰지 않으므로 제외하고 로드
  const unmapped = await models.lcu_game_raw.findAll({
    where: {
      statsProcessedAt: { [Op.ne]: null },
      mappedMatchId: null,
      gameCreation: { [Op.gte]: since },
    },
    attributes: { exclude: ['rawJson'] },
    order: [['gameCreation', 'ASC']],
  });
  for (const raw of unmapped) {
    try {
      if (await fireOnMapped(onMapped, await remapRaw(raw))) mapped += 1;
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
  // rawJson(게임당 수백 KB)은 실제 재처리 대상에만 필요하므로, 키만 먼저 훑어 대상을 좁힌다
  const rawKeys = await models.lcu_game_raw.findAll({
    where: { statsProcessedAt: { [Op.ne]: null }, gameCreation: { [Op.gte]: since } },
    attributes: ['riotGameKey'],
    raw: true,
  });
  if (rawKeys.length === 0) return { checked: 0, healed: 0 };

  const statRows = await models.match_player_stat.findAll({
    where: { riotGameKey: { [Op.in]: rawKeys.map((r) => r.riotGameKey) } },
    attributes: ['riotGameKey', 'puuid'],
    raw: true,
  });
  // LCU puuid는 UUID(36자), 정식 puuid는 78자 — 길이로 폴백 행 식별
  const unbridgedKeys = new Set(
    statRows.filter((r) => r.puuid && r.puuid.length < 50).map((r) => r.riotGameKey),
  );
  if (unbridgedKeys.size === 0) return { checked: 0, healed: 0 };

  const raws = await models.lcu_game_raw.findAll({
    where: { riotGameKey: { [Op.in]: [...unbridgedKeys] } },
  });

  let healed = 0;
  for (const raw of raws) {
    try {
      await models.match_player_stat.destroy({ where: { riotGameKey: raw.riotGameKey } });
      await models.match_team_stat.destroy({ where: { riotGameKey: raw.riotGameKey } });
      const result = await processRaw(raw);
      healed += 1;
      await fireOnMapped(onMapped, result);
    } catch (e) {
      logger.error(`[collector] 스탯 치유 실패 (${raw.riotGameKey}): ${e.message}`);
    }
  }
  return { checked: unbridgedKeys.size, healed };
}

module.exports = {
  ingestGame,
  processRaw,
  retryUnmappedRaws,
  healUnbridgedStats,
  resolveGroupFromPuuids,
  resolveDbPuuids,
  // 테스트용 순수 함수
  extractPlayers,
  resolveTeamPositions,
  pickBestCandidate,
  verifyLive,
  verifyChampSelect,
};
