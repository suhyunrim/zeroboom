/**
 * AI 채팅용 "브릿지" — AI가 호출하는 읽기 전용 도구의 실제 구현.
 *
 * 원칙
 * - 모든 함수는 첫 인자로 groupId를 받고, 그 그룹 데이터만 반환한다(크로스그룹 차단).
 *   groupId는 호출부(서버)가 주입하며 AI/유저 입력에서 오지 않는다.
 * - 읽기 전용. 민감 필드(puuid/discordId 등)는 응답에서 제외한다.
 * - 계산 핵심은 순수 함수로 분리해 DB 없이 단위 테스트할 수 있게 한다.
 */
const { Op } = require('sequelize');
const models = require('../../db/models');
const { definitions } = require('../achievement/definitions');
const { resolveStatType } = require('../../controller/achievement');
const { formatTier, normalizePosition } = require('../../utils/tierUtils');
const { comfortAt, FIT_CEILING } = require('../../match-maker/position-balance');

// ───────────────────────── 순수 코어 (테스트 대상) ─────────────────────────

const METRICS = {
  games: (p) => (p.win || 0) + (p.lose || 0),
  winRate: (p) => {
    const g = (p.win || 0) + (p.lose || 0);
    return g > 0 ? Math.round(((p.win || 0) / g) * 1000) / 10 : 0;
  },
  rating: (p) => p.rating || 0,
  tenureDays: (p) => {
    if (!p.firstMatchDate) return 0;
    return Math.floor((Date.now() - new Date(p.firstMatchDate).getTime()) / 86400000);
  },
};

/**
 * 플레이어 목록을 metric 기준으로 정렬해 상위 N명 반환 (순수).
 * @param {Array} players - [{ name, rankTier, mainPosition, win, lose, rating, firstMatchDate }]
 * @param {{metric:string, order?:'desc'|'asc', limit?:number, minGames?:number}} opts
 */
function rankPlayers(players, { metric, order = 'desc', limit = 10, minGames = 1 } = {}) {
  const fn = METRICS[metric];
  if (!fn) throw new Error(`unknown metric: ${metric}`);
  // 승률은 표본이 적으면 왜곡되므로 최소 판수 필터
  const pool = metric === 'winRate'
    ? players.filter((p) => (p.win || 0) + (p.lose || 0) >= Math.max(minGames, 5))
    : players;
  const scored = pool.map((p) => ({
    name: p.name,
    rankTier: p.rankTier || null,
    mainPosition: p.mainPosition || null,
    games: (p.win || 0) + (p.lose || 0),
    win: p.win || 0,
    lose: p.lose || 0,
    ratingTier: formatTier(p.rating || 0), // 내전 레이팅 → 티어. raw 점수는 LLM에 노출하지 않는다.
    _sort: fn(p),
  }));
  scored.sort((a, b) => (order === 'asc' ? a._sort - b._sort : b._sort - a._sort));
  return scored.slice(0, Math.min(limit || 10, 25)).map((p, i) => {
    const { _sort, ...rest } = p;
    // 메트릭 값: rating이면 티어 문자열, 그 외엔 raw 수치(판수/승률% 등)
    return { rank: i + 1, ...rest, value: metric === 'rating' ? rest.ratingTier : _sort };
  });
}

/**
 * "고인물" 종합 순위 (순수). 판수·가입기간을 코드가 합성해 종합 정렬한다.
 *
 * ★ 이 함수의 목적: "고인물 종합"을 코드가 결정한다. 예전엔 LLM이 판수 top-N과 가입 top-N
 *   두 리스트를 머릿속에서 합치다 없는 순위를 지어냈다(환각). 여기서 grounded 표를 만들어
 *   주면 모델은 읽어주기만 하면 된다.
 * - 합성 = 정규화 평균: 각 지표를 로스터 최대값 대비 0~1로 환산해 평균(×100, 클수록 고인물).
 *   ★ 랭크 합산이 아니라 값(magnitude) 기반이라, 가입일 하루 차이는 점수에 거의 영향이 없다.
 *   (랭크합은 "164일=4위 vs 165일=2위"처럼 1일 차를 큰 순위차로 왜곡함)
 * - gamesRank/tenureRank(competition ranking, 동점=같은 순위)도 투명성용으로 함께 반환.
 * - score 동점이면 판수 많은 쪽을 앞에 둔다.
 * @param {Array} players - [{ name, rankTier, win, lose, firstMatchDate }]
 * @param {{limit?:number}} opts
 */
function rankVeterans(players, { limit = 10 } = {}) {
  const base = players.map((p) => ({
    name: p.name,
    rankTier: p.rankTier || null,
    games: (p.win || 0) + (p.lose || 0),
    tenureDays: METRICS.tenureDays(p),
  }));
  if (!base.length) return [];

  const maxGames = Math.max(1, ...base.map((p) => p.games));
  const maxTenure = Math.max(1, ...base.map((p) => p.tenureDays));

  // 값 → 순위(competition ranking). 같은 값은 같은 순위(165일 셋 → 모두 같은 가입순위).
  const rankMapOf = (key) => {
    const sorted = [...base].sort((a, b) => b[key] - a[key]);
    const m = new Map();
    sorted.forEach((p, i) => { if (!m.has(p[key])) m.set(p[key], i + 1); });
    return m;
  };
  const gamesRankOf = rankMapOf('games');
  const tenureRankOf = rankMapOf('tenureDays');

  const scored = base.map((p) => ({
    ...p,
    gamesRank: gamesRankOf.get(p.games),
    tenureRank: tenureRankOf.get(p.tenureDays),
    score: Math.round((((p.games / maxGames) + (p.tenureDays / maxTenure)) / 2) * 1000) / 10, // 0~100
  }));
  scored.sort((a, b) => b.score - a.score || b.games - a.games);
  return scored.slice(0, Math.min(limit || 10, 25)).map((p, i) => ({ rank: i + 1, ...p }));
}

/**
 * "최근 N판" 플레이어별 승/패 집계 (순수).
 * 윈도우(최근 매치 N개)의 각 매치에서 승리팀 전원에 1승, 패배팀 전원에 1패를 준다.
 * "전체 누적"이 아니라 "최근 N판 안에서만" 센다는 점이 query_players와의 차이.
 * @param {Array} matches - 윈도우 내 매치 [{ team1, team2, winTeam }] (team*=[[puuid,...], ...])
 * @param {Object} nameByPuuid - { puuid: name }
 * @param {{topN?:number}} opts
 * @returns {Array<{rank,name,wins,losses,games,winRate}>}
 */
function tallyRecentWins(matches, nameByPuuid = {}, { topN = 5 } = {}) {
  const puuidOf = (p) => (Array.isArray(p) ? p[0] : p);
  const acc = {}; // puuid -> { wins, losses }
  const bump = (puuid, key) => {
    if (!puuid) return;
    if (!acc[puuid]) acc[puuid] = { wins: 0, losses: 0 };
    acc[puuid][key] += 1;
  };
  for (const m of matches || []) {
    if (m.winTeam !== 1 && m.winTeam !== 2) continue; // 미완료 매치 제외
    const winners = (m.winTeam === 1 ? m.team1 : m.team2) || [];
    const losers = (m.winTeam === 1 ? m.team2 : m.team1) || [];
    winners.forEach((p) => bump(puuidOf(p), 'wins'));
    losers.forEach((p) => bump(puuidOf(p), 'losses'));
  }
  const rows = Object.entries(acc).map(([puuid, s]) => {
    const games = s.wins + s.losses;
    return {
      name: nameByPuuid[puuid] || '알 수 없음',
      wins: s.wins,
      losses: s.losses,
      games,
      winRate: games > 0 ? Math.round((s.wins / games) * 1000) / 10 : 0,
    };
  });
  rows.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.games - a.games);
  return rows.slice(0, Math.min(topN || 5, 25)).map((r, i) => ({ rank: i + 1, ...r }));
}

/**
 * 업적 진행도/갭 계산 (순수). 정의(코드) + 획득(DB) + 진행도(DB)를 합친다.
 * @param {Array} defs - definitions
 * @param {Set<string>} unlockedIds - 이미 획득한 업적 id
 * @param {Object} statsByType - { [statType]: value }
 * @param {(def)=>string|null} statTypeOf - resolveStatType
 * @param {{closestLimit?:number}} opts
 */
function computeAchievementProgress(defs, unlockedIds, statsByType, statTypeOf, { closestLimit = 8 } = {}) {
  const earned = [];
  const measurable = [];
  let otherLockedCount = 0;

  for (const d of defs) {
    if (unlockedIds.has(d.id)) {
      earned.push({ id: d.id, name: d.name, emoji: d.emoji, tier: d.tier, category: d.category });
      continue;
    }
    const statType = d.goal ? statTypeOf(d) : null;
    if (statType && d.goal) {
      const current = Number(statsByType[statType] || 0);
      const remaining = Math.max(0, d.goal - current);
      measurable.push({
        id: d.id,
        name: d.name,
        description: d.description,
        emoji: d.emoji,
        category: d.category,
        goal: d.goal,
        current,
        remaining,
        progressRate: d.goal ? Math.round((current / d.goal) * 1000) / 10 : 0,
      });
    } else {
      otherLockedCount += 1;
    }
  }

  // 가까운 순(남은 양 적은 순 → 진행률 높은 순)
  measurable.sort((a, b) => a.remaining - b.remaining || b.progressRate - a.progressRate);

  return {
    totalCount: defs.length,
    earnedCount: earned.length,
    earned,
    closest: measurable.slice(0, closestLimit),
    otherLockedCount,
  };
}

const TOURNAMENT_STATUS_LABEL = {
  preparing: '준비중',
  auction: '경매 진행중',
  in_progress: '진행중',
  finished: '종료',
};
const ACTIVE_TOURNAMENT_STATUSES = ['preparing', 'auction', 'in_progress'];

// ── 예상 순위 종합 모델의 튜닝 상수 (근거는 프로젝트 밸런스 분석; 보수적으로 잡음) ──
// 포지션 적합도 1점당 유효레이팅 델타(Elo). 100점=페널티 0, 낮을수록 감점.
// (2026-06-23 분석: +10점 ≈ OR 1.16. 레이팅이 주효과라 계수는 보수적으로 1.5)
const POS_ELO_PER_POINT = 1.5;
const POS_FIT_REF = 100;
// 시너지 +1%p(같은팀 승률이 개인 기대치보다 높은 정도)당 유효레이팅 델타(Elo).
const SYN_ELO_PER_PCT = 1.0;
// 시너지 페어로 인정할 최소 동반 판수(표본 적으면 노이즈).
const SYN_MIN_GAMES = 5;
// 스크림 맞대결 블렌드의 사전분포 가상판수(관측이 이만큼 쌓여야 Elo와 반반).
const SCRIM_PRIOR = 4;

// 대회 팀 members의 포지션 표기(top/jungle/mid/adc/support)를 소환사 mainPosition의
// Riot 표기(TOP/JUNGLE/MIDDLE/BOTTOM/SUPPORT)로 변환. 표기가 다르면 comfortAt 비교가
// 전부 불일치해 전원 오프포지션으로 계산되므로 반드시 같은 공간으로 맞춘다.
const TOURNAMENT_POS_TO_RIOT = {
  top: 'TOP',
  jungle: 'JUNGLE',
  jgl: 'JUNGLE',
  mid: 'MIDDLE',
  middle: 'MIDDLE',
  adc: 'BOTTOM',
  bot: 'BOTTOM',
  bottom: 'BOTTOM',
  support: 'SUPPORT',
  sup: 'SUPPORT',
  utility: 'SUPPORT',
};
function toRiotPosition(pos) {
  if (!pos) return null;
  return TOURNAMENT_POS_TO_RIOT[String(pos).toLowerCase()] || normalizePosition(String(pos).toUpperCase()) || null;
}

// 내전 포지션 이력 블렌드의 사전분포 가상판수(내전 판수가 이만큼 쌓이면 솔랭 기준과 반반).
const INTERNAL_POS_PRIOR = 10;

/**
 * 한 팀(5명)의 "배정된 포지션" 적합도 점수 0~100 (순수). 5명이 아니거나 배정 포지션이 없으면 null.
 * 플랜용 computeTeamPositionScore(최선 배정 탐색)와 달리, 대회 팀은 포지션이 이미 정해져 있어
 * 실제 배정 포지션에서의 편안도를 쓴다.
 * 편안도 = 솔랭 기준(메인/서브 포지션 비율, comfortAt)에 내전에서 실제 소화한 포지션 비율
 * (internalRate)을 내전 판수만큼 표본가중(w=n/(n+PRIOR))으로 혼합. 내전 이력 없으면 솔랭만.
 * @param {Array} players - [{ assigned, mainPos, subPos, mainPositionRate, subPositionRate,
 *                             internalRate?:number|null, internalGames?:number }] (정규화 완료)
 */
function assignedPositionFit(players) {
  if (!players || players.length !== 5) return null;
  if (players.some((p) => !p.assigned)) return null;
  const sum = players.reduce((acc, p) => {
    const solo = comfortAt(p, p.assigned);
    let comfort = solo;
    if (p.internalRate != null && p.internalGames > 0) {
      const w = p.internalGames / (p.internalGames + INTERNAL_POS_PRIOR);
      comfort = (w * p.internalRate) + ((1 - w) * solo);
    }
    return acc + Math.min(1, comfort / FIT_CEILING);
  }, 0);
  return Math.round((sum / 5) * 100);
}

/**
 * 팀 시너지 지표(%p, 순수). 팀 내 모든 페어에 대해 (같은팀 승률 − 두 명 개인 승률 평균)을 구해 평균낸다.
 * 동반 판수가 SYN_MIN_GAMES 미만인 페어는 제외. 인정 페어가 없으면 null.
 * @param {string[]} memberPuuids
 * @param {Object} indiv - { puuid: {games, wins} } 개인 통산
 * @param {Object} pairStats - { "a|b"(정렬): {games, wins} } 페어 동반 통산
 */
function teamSynergyPct(memberPuuids, indiv, pairStats, minGames = SYN_MIN_GAMES) {
  const deltas = [];
  for (let x = 0; x < memberPuuids.length; x += 1) {
    for (let y = x + 1; y < memberPuuids.length; y += 1) {
      const a = memberPuuids[x];
      const b = memberPuuids[y];
      const pr = pairStats[[a, b].sort().join('|')];
      const ia = indiv[a];
      const ib = indiv[b];
      if (!pr || pr.games < minGames || !ia || !ib || !ia.games || !ib.games) continue;
      const together = (pr.wins / pr.games) * 100;
      const expected = (((ia.wins / ia.games) + (ib.wins / ib.games)) / 2) * 100;
      deltas.push(together - expected);
    }
  }
  if (!deltas.length) return null;
  return Math.round((deltas.reduce((s, d) => s + d, 0) / deltas.length) * 10) / 10;
}

/**
 * 대회 팀들의 "예상 순위" 종합 모델 (순수).
 * 유효레이팅 = 평균 내전레이팅 + 포지션델타 + 시너지델타.
 * 팀 간 기대승률 = Elo(유효레이팅)에 스크림 맞대결이 있으면 관측 승률을 표본가중 블렌드.
 * 순위 = 나머지 팀 전체를 상대한 평균 기대승률(라운드로빈) 내림차순.
 * - 평균레이팅이 null인 팀(레이팅 멤버 없음)은 추정 불가 → 끝으로, expectedWinRate=null.
 * - raw 유효/평균 레이팅은 응답에서 제외(teamRatingTier·factor 수치만 노출).
 * @param {Array} teams - [{ teamId, name, avgRating:number|null, teamRatingTier, positionFitScore, synergyPct, scrimRecord, members }]
 * @param {Object} opts
 * @param {(a:number,b:number)=>number} opts.expected - expectedScore(ratingA, ratingB) → 0~1
 * @param {(tA:object,tB:object)=>{aWon:number,aLost:number}} [opts.pairScrim] - tA 관점 스크림 세트 전적
 */
function computeCompositeStandings(teams, opts = {}) {
  const {
    expected,
    pairScrim = () => ({ aWon: 0, aLost: 0 }),
    posEloPerPoint = POS_ELO_PER_POINT,
    synEloPerPct = SYN_ELO_PER_PCT,
    scrimPrior = SCRIM_PRIOR,
    posRef = POS_FIT_REF,
  } = opts;

  // 유효레이팅(레이팅 없으면 null)
  const eff = teams.map((t) => {
    if (t.avgRating == null) return null;
    const posDelta = t.positionFitScore != null ? (t.positionFitScore - posRef) * posEloPerPoint : 0;
    const synDelta = t.synergyPct != null ? t.synergyPct * synEloPerPct : 0;
    return t.avgRating + posDelta + synDelta;
  });

  const scored = teams.map((t, i) => {
    if (eff[i] == null) return { t, i, expectedWinRate: null };
    let sum = 0;
    let cnt = 0;
    teams.forEach((o, j) => {
      if (j === i || eff[j] == null) return;
      const eloProb = expected(eff[i], eff[j]);
      const s = pairScrim(t, o) || {};
      const games = (s.aWon || 0) + (s.aLost || 0);
      let prob = eloProb;
      if (games > 0) {
        const observed = s.aWon / games;
        const w = games / (games + scrimPrior);
        prob = (w * observed) + ((1 - w) * eloProb);
      }
      sum += prob;
      cnt += 1;
    });
    return { t, i, expectedWinRate: cnt ? Math.round((sum / cnt) * 1000) / 10 : null };
  });

  scored.sort((a, b) => {
    const ea = eff[a.i];
    const eb = eff[b.i];
    if (ea == null && eb == null) return 0;
    if (ea == null) return 1;
    if (eb == null) return -1;
    const wa = a.expectedWinRate == null ? -1 : a.expectedWinRate;
    const wb = b.expectedWinRate == null ? -1 : b.expectedWinRate;
    return wb - wa || eb - ea;
  });

  return scored.map((s, rank) => ({
    predictedRank: rank + 1,
    name: s.t.name,
    teamRatingTier: s.t.teamRatingTier,
    expectedWinRate: s.expectedWinRate,
    positionFitScore: s.t.positionFitScore ?? null,
    synergyPct: s.t.synergyPct ?? null,
    scrimRecord: s.t.scrimRecord || { won: 0, lost: 0, played: 0 },
    members: s.t.members,
  }));
}

/**
 * 대진표 매치들의 LLM 안전 투영 (순수). 팀 id → 이름 치환, 라운드 라벨 부여, 상태 계산.
 * 상태: finished(승자 확정, 한쪽 팀 없으면 bye=true) | scheduled(양팀 확정·경기 전) | waiting(대진 미정).
 * @param {Array} matches - tournament_match rows (round ASC, bracketSlot ASC)
 * @param {Object} nameById - { teamId: teamName }
 * @param {Object} roundLabels - { round: '8강'|'결승'|... } (computeRoundLabels 결과)
 */
function projectBracketMatches(matches, nameById, roundLabels) {
  return (matches || []).map((m) => {
    const team1Name = m.team1Id != null ? nameById[m.team1Id] || null : null;
    const team2Name = m.team2Id != null ? nameById[m.team2Id] || null : null;
    let status;
    if (m.winnerTeamId != null) status = 'finished';
    else if (m.team1Id != null && m.team2Id != null) status = 'scheduled';
    else status = 'waiting';
    const row = {
      roundLabel: roundLabels[m.round] || `라운드${m.round}`,
      round: m.round,
      slot: m.bracketSlot,
      team1: team1Name,
      team2: team2Name,
      score: `${m.team1Score || 0}:${m.team2Score || 0}`,
      bestOf: m.bestOf,
      status,
      winner: m.winnerTeamId != null ? nameById[m.winnerTeamId] || null : null,
      scheduledAt: m.scheduledAt || null,
    };
    // 부전승(BYE): 승자는 있는데 상대 팀이 없는 매치
    if (status === 'finished' && (m.team1Id == null || m.team2Id == null)) row.bye = true;
    return row;
  });
}

// ───────────────────────── DB 조회 헬퍼 ─────────────────────────

// 그룹의 활성 본캐(부캐/외부인/탈퇴 제외) + 소환사 정보
async function fetchActivePlayers(groupId) {
  const users = await models.user.findAll({
    where: { groupId, primaryPuuid: null, role: { [Op.ne]: 'outsider' }, leftGuildAt: null },
    attributes: ['puuid', 'win', 'lose', 'defaultRating', 'additionalRating', 'firstMatchDate'],
    raw: true,
  });
  if (!users.length) return [];
  const summoners = await models.summoner.findAll({
    where: { puuid: users.map((u) => u.puuid) },
    attributes: ['puuid', 'name', 'rankTier', 'mainPosition'],
    raw: true,
  });
  const sMap = summoners.reduce((acc, s) => { acc[s.puuid] = s; return acc; }, {});
  return users.map((u) => ({
    name: sMap[u.puuid]?.name || '알 수 없음',
    rankTier: sMap[u.puuid]?.rankTier || null,
    mainPosition: sMap[u.puuid]?.mainPosition || null,
    win: u.win || 0,
    lose: u.lose || 0,
    rating: (u.defaultRating || 0) + (u.additionalRating || 0),
    firstMatchDate: u.firstMatchDate || null,
  }));
}

// 그룹 내 이름(부분일치)으로 puuid 찾기.
// ★ 같은 이름의 소환사가 여러 그룹에 있을 수 있다(예: 쥬티키스#kr1=타그룹 / 쥬티키스#kr2=이 그룹).
//   이름 매칭 소환사들 중 "이 그룹에 속한" 사람을 고른다. 이전엔 전역 findOne이 타그룹 동명이인을
//   먼저 집어 그룹 멤버를 못 찾고 null을 반환하는 버그가 있었다(부분 이름 검색이 통째로 실패).
async function resolvePuuid(groupId, name) {
  const summoners = await models.summoner.findAll({
    where: { name: { [Op.like]: `%${name}%` } },
    attributes: ['puuid', 'name'],
    raw: true,
  });
  if (!summoners.length) return null;
  const user = await models.user.findOne({
    where: { groupId, puuid: { [Op.in]: summoners.map((s) => s.puuid) } },
    attributes: ['puuid'],
    raw: true,
  });
  if (!user) return null;
  const matched = summoners.find((s) => s.puuid === user.puuid);
  return { puuid: matched.puuid, name: matched.name };
}

// 그룹의 완료 매치를 1회 스캔해, 타깃 puuid들의 개인 통산·팀 내 페어 동반 통산(시너지용)과
// 내전에서 실제 소화한 포지션 이력(포지션 적합도의 내전 기준)을 집계.
// { indiv: {puuid:{games,wins}}, pairStats: {"a|b":{games,wins}}, posCounts: {puuid:{RIOT포지션:판수}} }
async function fetchSynergyStats(groupId, targetPuuids) {
  const set = new Set(targetPuuids);
  if (!set.size) return { indiv: {}, pairStats: {}, posCounts: {} };
  const rows = await models.match.findAll({
    where: { groupId, winTeam: { [Op.ne]: null } },
    attributes: ['team1', 'team2', 'winTeam'],
    raw: true,
  });
  const parse = (v) => { try { return JSON.parse(v); } catch (e) { return []; } };
  const puuidOf = (p) => (Array.isArray(p) ? p[0] : p);
  const indiv = {};
  const pairStats = {};
  const posCounts = {};
  for (const m of rows) {
    if (m.winTeam !== 1 && m.winTeam !== 2) continue;
    for (const teamNo of [1, 2]) {
      const entries = (teamNo === 1 ? parse(m.team1) : parse(m.team2)).filter((p) => set.has(puuidOf(p)));
      const arr = entries.map(puuidOf);
      const won = m.winTeam === teamNo;
      entries.forEach((p) => {
        const puuid = puuidOf(p);
        const s = indiv[puuid] || (indiv[puuid] = { games: 0, wins: 0 });
        s.games += 1;
        if (won) s.wins += 1;
        // 스냅샷 [puuid, name, rating, position]의 포지션(구포맷엔 없음 → 스킵)
        const pos = Array.isArray(p) ? toRiotPosition(p[3]) : null;
        if (pos) {
          const pcs = posCounts[puuid] || (posCounts[puuid] = {});
          pcs[pos] = (pcs[pos] || 0) + 1;
        }
      });
      for (let x = 0; x < arr.length; x += 1) {
        for (let y = x + 1; y < arr.length; y += 1) {
          const key = [arr[x], arr[y]].sort().join('|');
          const s = pairStats[key] || (pairStats[key] = { games: 0, wins: 0 });
          s.games += 1;
          if (won) s.wins += 1;
        }
      }
    }
  }
  return { indiv, pairStats, posCounts };
}

// ───────────────────────── 브릿지 (AI가 호출) ─────────────────────────

/**
 * 플레이어 랭킹. metric: games(고인물/판수) | winRate(승률) | rating(레이팅) | tenureDays(가입기간)
 */
async function queryPlayers(groupId, { metric = 'rating', order = 'desc', limit = 10 } = {}) {
  if (!METRICS[metric]) {
    return { error: `지원하지 않는 metric: ${metric}. 사용 가능: ${Object.keys(METRICS).join(', ')}` };
  }
  const players = await fetchActivePlayers(groupId);
  return { metric, count: players.length, players: rankPlayers(players, { metric, order, limit }) };
}

/**
 * "고인물/올드비/짬" 종합 순위. 판수+가입기간을 코드가 합산해 종합 순위로 반환한다.
 * "고인물 누구?" 류는 이 도구 하나로 답한다(query_players 두 번 합치기 금지).
 */
async function queryVeterans(groupId, { limit = 10 } = {}) {
  const players = await fetchActivePlayers(groupId);
  return { count: players.length, veterans: rankVeterans(players, { limit }) };
}

/**
 * "최근 N판" 승리 순위. 그룹의 가장 최근 완료된 매치 N개를 모아 플레이어별 승/패를 집계한다.
 * query_players(전체 누적)와 달리 최근성 윈도우를 적용한다. "최근 100판 중 승리왕?" 류에 사용.
 * @param {{matches?:number, topN?:number}} opts - matches: 최근 매치 수(기본 100, 최대 500)
 */
async function queryRecentWins(groupId, { matches = 100, topN = 5 } = {}) {
  const requested = Number(matches) || 100;
  const windowSize = Math.min(Math.max(requested, 1), 500);
  const rows = await models.match.findAll({
    where: { groupId, winTeam: { [Op.ne]: null } },
    attributes: ['team1', 'team2', 'winTeam', 'createdAt'],
    order: [['createdAt', 'DESC']], // 최신순 → 윈도우 상한만큼만
    limit: windowSize,
    raw: true,
  });
  const safeParse = (v) => { try { return JSON.parse(v); } catch (e) { return []; } };
  const parsed = rows.map((m) => ({ team1: safeParse(m.team1), team2: safeParse(m.team2), winTeam: m.winTeam }));

  // 윈도우에 등장한 puuid → 소환사명 (한 번에 조회)
  const puuids = new Set();
  parsed.forEach((m) => [...m.team1, ...m.team2].forEach((p) => puuids.add(Array.isArray(p) ? p[0] : p)));
  const summoners = puuids.size
    ? await models.summoner.findAll({ where: { puuid: [...puuids] }, attributes: ['puuid', 'name'], raw: true })
    : [];
  const nameByPuuid = summoners.reduce((acc, s) => { acc[s.puuid] = s.name; return acc; }, {});

  return {
    matchesRequested: requested,
    matchesConsidered: parsed.length, // 실제 집계된 매치 수(요청보다 적으면 그만큼만 존재)
    players: tallyRecentWins(parsed, nameByPuuid, { topN }),
  };
}

/**
 * 한 플레이어 상세. 민감 필드는 제외하고 요약 반환.
 */
async function getPlayer(groupId, { name }) {
  if (!name) return { error: 'name이 필요합니다.' };
  const resolved = await resolvePuuid(groupId, name);
  if (!resolved) return { error: `'${name}' 을(를) 이 그룹에서 찾지 못했습니다.` };

  const userController = require('../../controller/user');
  const info = await userController.getInfo(groupId, resolved.puuid);
  if (info.status !== 200) return { error: '플레이어 정보를 불러오지 못했습니다.' };

  const r = info.result;
  const s = r.summonerInfo || {};
  const d = r.detailedStats || {};
  const u = r.userInfo || {};
  // LLM에 줄 안전한 투영 (puuid/discordId 등 제외)
  return {
    name: s.name,
    rankTier: s.rankTier || null,
    mainPosition: s.mainPosition || null,
    mainPositionRate: s.mainPositionRate ?? null,
    subPosition: s.subPosition || null,
    subPositionRate: s.subPositionRate ?? null,
    win: u.win ?? null,
    lose: u.lose ?? null,
    ratingTier: formatTier((u.defaultRating || 0) + (u.additionalRating || 0)), // 내전 레이팅 → 티어 (raw 미노출)
    recentWinRate: d.recentWinRate ?? null,
    maxWinStreak: d.maxWinStreak ?? null,
    maxLoseStreak: d.maxLoseStreak ?? null,
    positionStats: d.positionStats || null, // 내전 포지션별 승패/승률 (10인 지정 매치 기준)
    mostChampions: r.mostChampions || [],
    honorPoints: r.honorStats?.received ?? null,
  };
}

/**
 * compare 결과 → LLM 안전 투영 (순수 함수).
 * puuid 제외, 절대 레이팅은 티어로 변환, holder('A'|'B')는 실제 이름으로 치환,
 * 궤적/경기목록은 토큰 절약을 위해 제외한다.
 */
function projectCompareReport(r) {
  const nameOf = (holder) => (holder === 'A' ? r.header.a.name : holder === 'B' ? r.header.b.name : null);
  const toHeader = (h) => ({
    name: h.name,
    ratingTier: formatTier(h.rating), // 내전 레이팅 → 티어 (raw 미노출)
    rankTier: h.rankTier,
    mainPosition: h.mainPosition,
    win: h.wins,
    lose: h.losses,
    winRate: h.winRate,
  });
  const stripPuuid = ({ name, withA, withB, avgWinRate }) => ({ name, withA, withB, avgWinRate });

  return {
    a: toHeader(r.header.a),
    b: toHeader(r.header.b),
    headToHead: {
      games: r.headToHead.games,
      aWins: r.headToHead.aWins,
      bWins: r.headToHead.bWins,
      aWinRate: r.headToHead.aWinRate,
      currentStreak: r.headToHead.currentStreak.holder
        ? { holderName: nameOf(r.headToHead.currentStreak.holder), count: r.headToHead.currentStreak.count }
        : null,
      maxStreak: { a: r.headToHead.maxStreak.a, b: r.headToHead.maxStreak.b },
    },
    together: r.together,
    pointsFlow: {
      takenByA: r.ratingFlow.takenByA,
      takenByB: r.ratingFlow.takenByB,
      net: r.ratingFlow.net,
    },
    timeline: {
      firstVsDate: r.timeline.firstVs ? r.timeline.firstVs.date : null,
      firstVsWinnerName: r.timeline.firstVs ? nameOf(r.timeline.firstVs.winner) : null,
      firstTogetherDate: r.timeline.firstTogether ? r.timeline.firstTogether.date : null,
      firstTogetherWon: r.timeline.firstTogether ? r.timeline.firstTogether.won : null,
      lastMetAt: r.timeline.lastMetAt,
      vsGames: r.timeline.vsGames,
      togetherGames: r.timeline.togetherGames,
      totalGames: r.timeline.totalGames,
    },
    laneMatchup: r.laneMatchup,
    relationTitles: r.relationTitles.map((t) => ({
      label: t.label,
      ...(t.holder ? { holderName: nameOf(t.holder) } : {}),
    })),
    mutualSynergy: {
      goodWithBoth: r.mutualSynergy.goodWithBoth.map(stripPuuid),
      badWithBoth: r.mutualSynergy.badWithBoth.map(stripPuuid),
      goodForABadForB: r.mutualSynergy.goodForABadForB.map(stripPuuid),
      goodForBBadForA: r.mutualSynergy.goodForBBadForA.map(stripPuuid),
    },
    tournament: {
      togetherChampionships: r.tournament.togetherChampionships.map(({ name, teamName, heldAt }) => ({ name, teamName, heldAt })),
      sameTeam: r.tournament.sameTeam.map(({ name, teamName, heldAt }) => ({ name, teamName, heldAt })),
      vs: {
        matches: r.tournament.vs.matches,
        aWins: r.tournament.vs.aWins,
        bWins: r.tournament.vs.bWins,
        byTournament: (r.tournament.vs.byTournament || []).map(
          ({ name, aTeamName, bTeamName, aWins, bWins }) => ({ name, aTeamName, bTeamName, aWins, bWins }),
        ),
      },
    },
  };
}

/**
 * 두 플레이어 1:1 비교. 상대전적/같은팀 시너지/점수 이동/타임라인/토너먼트 인연 요약.
 * "나랑 ㅇㅇ 상대전적 어때?", "ㅇㅇ랑 ㅇㅇ 누가 이겨?" 류에 사용.
 */
async function comparePlayers(groupId, { nameA, nameB }) {
  if (!nameA || !nameB) return { error: 'nameA와 nameB가 필요합니다.' };
  const [resolvedA, resolvedB] = await Promise.all([resolvePuuid(groupId, nameA), resolvePuuid(groupId, nameB)]);
  if (!resolvedA) return { error: `'${nameA}' 을(를) 이 그룹에서 찾지 못했습니다.` };
  if (!resolvedB) return { error: `'${nameB}' 을(를) 이 그룹에서 찾지 못했습니다.` };
  if (resolvedA.puuid === resolvedB.puuid) return { error: '같은 플레이어입니다. 서로 다른 두 명을 지정해주세요.' };

  const compareController = require('../../controller/compare');
  const cmp = await compareController.compareUsers(groupId, resolvedA.puuid, resolvedB.puuid);
  if (cmp.status !== 200) {
    return { error: typeof cmp.result === 'string' ? cmp.result : '비교 정보를 불러오지 못했습니다.' };
  }
  return projectCompareReport(cmp.result);
}

/**
 * 업적 진행도/다음 목표. "업적 더 따려면?" 류에 사용.
 */
async function getAchievementProgress(groupId, { name }) {
  if (!name) return { error: 'name이 필요합니다.' };
  const resolved = await resolvePuuid(groupId, name);
  if (!resolved) return { error: `'${name}' 을(를) 이 그룹에서 찾지 못했습니다.` };

  const [unlocks, stats] = await Promise.all([
    models.user_achievement.findAll({
      where: { groupId, puuid: resolved.puuid },
      attributes: ['achievementId'],
      raw: true,
    }),
    models.user_achievement_stats.findAll({
      where: { groupId, puuid: resolved.puuid },
      attributes: ['statType', 'value'],
      raw: true,
    }),
  ]);
  const unlockedIds = new Set(unlocks.map((u) => u.achievementId));
  const statsByType = stats.reduce((acc, s) => { acc[s.statType] = Number(s.value); return acc; }, {});

  return {
    name: resolved.name,
    ...computeAchievementProgress(definitions, unlockedIds, statsByType, resolveStatType),
  };
}

// 대회 메타(LLM 안전 투영) — id/championTeamId 원시값은 노출하지 않는다.
function projectTournamentMeta(t) {
  return {
    name: t.name,
    type: t.type,
    status: t.status,
    statusLabel: TOURNAMENT_STATUS_LABEL[t.status] || t.status,
    teamCount: t.teamCount ?? null,
    heldAt: t.heldAt || null,
    championDecided: !!t.championTeamId,
  };
}

// 그룹의 대회를 이름(부분일치)으로 찾는다. 이름 생략 시 진행 중(가장 최근) 대회를 고른다.
// 못 찾으면 { error, available? }, 찾으면 { tournament }.
async function resolveTournament(groupId, name) {
  const rows = await models.tournament.findAll({
    where: { groupId },
    attributes: ['id', 'name', 'type', 'status', 'teamCount', 'bracketSize', 'heldAt', 'championTeamId'],
    order: [['id', 'DESC']],
    raw: true,
  });
  if (!rows.length) return { error: '이 그룹에는 아직 등록된 대회가 없어요.' };

  let pool;
  if (name && name.trim()) {
    const q = name.trim().toLowerCase();
    pool = rows.filter((r) => (r.name || '').toLowerCase().includes(q));
    if (!pool.length) return { error: `'${name}' 대회를 찾지 못했어요.`, available: rows.map((r) => r.name) };
  } else {
    const active = rows.filter((r) => ACTIVE_TOURNAMENT_STATUSES.includes(r.status));
    pool = active.length ? active : rows;
  }
  // 여러 개면 진행 중 우선, 그다음 최신(id desc)
  pool.sort((a, b) => {
    const aa = ACTIVE_TOURNAMENT_STATUSES.includes(a.status) ? 0 : 1;
    const bb = ACTIVE_TOURNAMENT_STATUSES.includes(b.status) ? 0 : 1;
    return aa - bb || b.id - a.id;
  });
  return { tournament: pool[0] };
}

/**
 * 그룹의 대회 목록. 진행 중/준비 중 대회도 포함한다(종료된 대회만이 아님).
 * "무슨 대회 있어?", "진행 중인 대회 뭐야?" 류에 사용. status로 거를 수 있다.
 */
async function listTournaments(groupId, { status } = {}) {
  const rows = await models.tournament.findAll({
    where: { groupId },
    attributes: ['id', 'name', 'type', 'status', 'teamCount', 'heldAt', 'championTeamId'],
    order: [['id', 'DESC']],
    raw: true,
  });
  const filtered = status ? rows.filter((r) => r.status === status) : rows;
  return { count: filtered.length, tournaments: filtered.map(projectTournamentMeta) };
}

/**
 * 한 대회의 대진표(브라켓). 라운드별 매치(팀명/스코어/승자/상태)를 라운드 라벨과 함께 반환.
 * "대진표 보여줘", "누구랑 누구 붙어?", "결승 어디까지 왔어?" 류에 사용.
 */
async function getTournamentBracket(groupId, { name } = {}) {
  const resolved = await resolveTournament(groupId, name);
  if (resolved.error) return resolved;
  const t = resolved.tournament;

  const [matches, teams] = await Promise.all([
    models.tournament_match.findAll({
      where: { tournamentId: t.id },
      attributes: ['round', 'bracketSlot', 'team1Id', 'team2Id', 'team1Score', 'team2Score', 'winnerTeamId', 'bestOf', 'scheduledAt'],
      order: [['round', 'ASC'], ['bracketSlot', 'ASC']],
      raw: true,
    }),
    models.tournament_team.findAll({
      where: { tournamentId: t.id },
      attributes: ['id', 'name'],
      raw: true,
    }),
  ]);
  if (!matches.length) {
    return { tournament: projectTournamentMeta(t), error: `'${t.name}' 대회는 아직 대진표가 생성되지 않았어요.` };
  }

  const nameById = {};
  teams.forEach((tm) => { nameById[tm.id] = tm.name; });

  const tournamentController = require('../../controller/tournament');
  const roundLabels = tournamentController.computeRoundLabels(t.bracketSize, t.teamCount || teams.length);
  const projected = projectBracketMatches(matches, nameById, roundLabels);

  return {
    tournament: {
      ...projectTournamentMeta(t),
      teamCount: teams.length,
      championName: t.championTeamId != null ? nameById[t.championTeamId] || null : null,
    },
    matches: projected,
    note: 'status: finished=경기 완료(bye=true면 부전승), scheduled=양팀 확정·경기 전, waiting=이전 라운드 결과 대기(대진 미정). score는 세트 스코어예요.',
  };
}

/**
 * 한 대회의 팀 로스터 + "예상 순위". 진행 중/준비 중 대회도 가능.
 * 팀 평균 내전 레이팅에 포지션 적합도·시너지를 반영하고, 스크림 맞대결이 있으면 그 결과를 가중 반영한
 * 종합 추정치로 순위를 매긴다. "○○ 대회 팀 목록", "각 팀 예상 순위", "우승 예상" 류에 사용.
 */
async function predictTournament(groupId, { name } = {}) {
  const resolved = await resolveTournament(groupId, name);
  if (resolved.error) return resolved;
  const t = resolved.tournament;

  const teamsRaw = await models.tournament_team.findAll({
    where: { tournamentId: t.id },
    attributes: ['id', 'name', 'captainPuuid', 'members'],
    raw: true,
  });
  if (!teamsRaw.length) {
    return { tournament: projectTournamentMeta(t), error: `'${t.name}' 대회에 아직 등록된 팀이 없어요.` };
  }

  const puuids = [...new Set(teamsRaw.flatMap((tm) => (tm.members || []).map((m) => m.puuid)).filter(Boolean))];
  const [users, summoners, scrims, synergy] = await Promise.all([
    puuids.length
      ? models.user.findAll({ where: { groupId, puuid: puuids }, attributes: ['puuid', 'defaultRating', 'additionalRating'], raw: true })
      : [],
    puuids.length
      ? models.summoner.findAll({ where: { puuid: puuids }, attributes: ['puuid', 'name', 'mainPosition', 'mainPositionRate', 'subPosition', 'subPositionRate'], raw: true })
      : [],
    models.tournament_scrim.findAll({ where: { tournamentId: t.id }, attributes: ['team1Id', 'team2Id', 'team1Score', 'team2Score'], raw: true }),
    fetchSynergyStats(groupId, puuids),
  ]);
  const ratingByPuuid = {};
  users.forEach((u) => { ratingByPuuid[u.puuid] = (u.defaultRating || 0) + (u.additionalRating || 0); });
  const summonerByPuuid = {};
  summoners.forEach((s) => { summonerByPuuid[s.puuid] = s; });

  const tournamentController = require('../../controller/tournament');
  const teams = teamsRaw.map((tm) => {
    const rawMembers = tm.members || [];
    const avgRating = tournamentController.computeTeamAvgRating(rawMembers, ratingByPuuid);
    // 포지션 적합도(실제 배정 포지션 기준)
    const fitPlayers = rawMembers.map((m) => {
      const s = summonerByPuuid[m.puuid] || {};
      const assigned = toRiotPosition(m.position); // 대회 표기(adc 등) → Riot 표기(BOTTOM 등)
      // 내전에서 실제 소화한 포지션 비율(포지션 스냅샷 있는 완료 매치 기준)
      const pc = synergy.posCounts[m.puuid];
      const internalGames = pc ? Object.values(pc).reduce((a, b) => a + b, 0) : 0;
      const internalRate = assigned && internalGames > 0 ? ((pc[assigned] || 0) / internalGames) * 100 : null;
      return {
        assigned,
        mainPos: normalizePosition(s.mainPosition) || null,
        subPos: normalizePosition(s.subPosition) || null,
        mainPositionRate: s.mainPositionRate || 0,
        subPositionRate: s.subPositionRate || 0,
        internalRate,
        internalGames,
      };
    });
    return {
      teamId: tm.id,
      name: tm.name,
      teamRatingTier: avgRating != null ? formatTier(avgRating) : null,
      avgRating, // 계산용 — 응답에선 제거됨
      positionFitScore: assignedPositionFit(fitPlayers),
      synergyPct: teamSynergyPct(rawMembers.map((m) => m.puuid), synergy.indiv, synergy.pairStats),
      scrimRecord: tournamentController.computeTeamScrimRecord(tm.id, scrims),
      members: rawMembers.map((m) => ({
        name: summonerByPuuid[m.puuid]?.name || '알 수 없음',
        position: m.position || null,
        ratingTier: ratingByPuuid[m.puuid] != null ? formatTier(ratingByPuuid[m.puuid]) : null,
        isCaptain: m.puuid === tm.captainPuuid,
      })),
    };
  });

  const teamById = {};
  teams.forEach((tm) => { teamById[tm.teamId] = tm; });
  const pairScrim = (tA, tB) => {
    const h = tournamentController.computeHeadToHeadScrim(tA.teamId, tB.teamId, scrims);
    return { aWon: h.team1.won, aLost: h.team1.lost };
  };

  const standings = computeCompositeStandings(teams, {
    expected: tournamentController.computeWinProbability,
    pairScrim,
  });

  return {
    tournament: { ...projectTournamentMeta(t), teamCount: teamsRaw.length },
    standings,
    scrimCount: scrims.length,
    note: '예상 순위는 팀 평균 내전 레이팅에 포지션 적합도·시너지를 반영하고, 이 대회 팀끼리의 스크림 맞대결이 있으면 그 결과를 표본 크기만큼 가중해 합산한 종합 추정치예요(실제 결과와 다를 수 있어요). '
      + 'expectedWinRate=다른 팀 전체 상대 평균 승리 확률(%), positionFitScore=배정 포지션 적합도(0~100, 높을수록 제 포지션 — 솔랭 포지션 비율과 내전에서 실제 소화한 포지션 이력을 내전 판수만큼 가중해 혼합), '
      + 'synergyPct=팀 내 같은팀 시너지(개인 기대치 대비 %p, +면 손발이 잘 맞음, null이면 표본 부족), scrimRecord=대회 내 스크림 세트 전적. '
      + '레이팅 없는 신규 멤버는 팀 평균에서 제외돼요.',
  };
}

module.exports = {
  // 순수 코어 (테스트)
  rankPlayers,
  rankVeterans,
  tallyRecentWins,
  computeAchievementProgress,
  projectCompareReport,
  computeCompositeStandings,
  assignedPositionFit,
  teamSynergyPct,
  toRiotPosition,
  projectBracketMatches,
  METRICS,
  // 브릿지
  queryPlayers,
  queryVeterans,
  queryRecentWins,
  getPlayer,
  getAchievementProgress,
  comparePlayers,
  listTournaments,
  getTournamentBracket,
  predictTournament,
  // 헬퍼 (에이전트에서 도구 디스패치에 사용)
  _internal: { fetchActivePlayers, resolvePuuid, resolveTournament, projectTournamentMeta },
};
