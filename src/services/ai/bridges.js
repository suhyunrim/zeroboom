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
    rating: p.rating || 0,
    value: fn(p),
  }));
  scored.sort((a, b) => (order === 'asc' ? a.value - b.value : b.value - a.value));
  return scored.slice(0, Math.min(limit || 10, 25)).map((p, i) => ({ rank: i + 1, ...p }));
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
    rating: (u.defaultRating || 0) + (u.additionalRating || 0),
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
  computeAchievementProgress,
  METRICS,
  // 브릿지
  queryPlayers,
  getPlayer,
  getAchievementProgress,
  // 헬퍼 (에이전트에서 도구 디스패치에 사용)
  _internal: { fetchActivePlayers, resolvePuuid },
};
