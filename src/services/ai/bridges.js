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
const { formatTier } = require('../../utils/tierUtils');

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

// 그룹 내 이름(부분일치)으로 본캐 puuid 찾기
async function resolvePuuid(groupId, name) {
  const summoner = await models.summoner.findOne({
    where: { name: { [Op.like]: `%${name}%` } },
    attributes: ['puuid', 'name'],
    raw: true,
  });
  if (!summoner) return null;
  const user = await models.user.findOne({
    where: { groupId, puuid: summoner.puuid },
    attributes: ['puuid'],
    raw: true,
  });
  return user ? { puuid: summoner.puuid, name: summoner.name } : null;
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

module.exports = {
  // 순수 코어 (테스트)
  rankPlayers,
  rankVeterans,
  tallyRecentWins,
  computeAchievementProgress,
  METRICS,
  // 브릿지
  queryPlayers,
  queryVeterans,
  queryRecentWins,
  getPlayer,
  getAchievementProgress,
  // 헬퍼 (에이전트에서 도구 디스패치에 사용)
  _internal: { fetchActivePlayers, resolvePuuid },
};
