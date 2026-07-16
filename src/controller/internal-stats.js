const { Op } = require('sequelize');
const models = require('../db/models');
const { resolveChampionNames } = require('../utils/champion-map');

const TIERLIST_MIN_GAMES_DEFAULT = 5;
const SCORE_SMOOTHING_GAMES = 5; // 승률 베이지안 보정: 5판 분량을 50%로 간주

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

// KDA 평균: (K+A)/D, 0데스면 perfect 처리로 K+A 반환
const avgKda = (kills, deaths, assists) =>
  deaths === 0 ? kills + assists : round2((kills + assists) / deaths);

// 행 목록을 keyFn 기준으로 집계
function aggregate(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key === null || key === undefined) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        games: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
        durationSec: 0,
        damageToChampions: 0,
        diffGames: 0,
        csDiffSum: 0,
        goldDiffSum: 0,
        damageDiffSum: 0,
      });
    }
    const g = groups.get(key);
    g.games += 1;
    g.wins += row.win ? 1 : 0;
    g.kills += row.kills;
    g.deaths += row.deaths;
    g.assists += row.assists;
    g.cs += row.cs;
    g.durationSec += row.gameDurationSec;
    g.damageToChampions += row.damageToChampions;
    if (row.csDiff !== null) {
      g.diffGames += 1;
      g.csDiffSum += row.csDiff;
      g.goldDiffSum += row.goldDiff || 0;
      g.damageDiffSum += row.damageDiff || 0;
    }
  }
  return groups;
}

const winRate = (g) => round1((g.wins / g.games) * 100);
const csPerMin = (g) => (g.durationSec > 0 ? round1(g.cs / (g.durationSec / 60)) : 0);
const dpm = (g) => (g.durationSec > 0 ? Math.round(g.damageToChampions / (g.durationSec / 60)) : 0);

/**
 * 유저의 내전 챔피언 통계 + 포지션별 라인전 지표
 */
async function getUserInternalStats({ groupId, puuid }) {
  const rows = await models.match_player_stat.findAll({
    where: { groupId, puuid },
    raw: true,
  });

  if (rows.length === 0) {
    return { totalGames: 0, wins: 0, champions: [], positions: [] };
  }

  const champGroups = aggregate(rows, (r) => r.championId);
  const names = await resolveChampionNames([...champGroups.keys()]);
  const champions = [...champGroups.entries()]
    .map(([championId, g]) => ({
      championId,
      championName: names[championId].name,
      championKoName: names[championId].koName,
      games: g.games,
      wins: g.wins,
      winRate: winRate(g),
      kills: round1(g.kills / g.games),
      deaths: round1(g.deaths / g.games),
      assists: round1(g.assists / g.games),
      kda: avgKda(g.kills, g.deaths, g.assists),
      csPerMin: csPerMin(g),
    }))
    .sort((a, b) => b.games - a.games || b.wins - a.wins);

  const posGroups = aggregate(rows, (r) => r.position);
  const positions = [...posGroups.entries()]
    .map(([position, g]) => ({
      position,
      games: g.games,
      wins: g.wins,
      winRate: winRate(g),
      kda: avgKda(g.kills, g.deaths, g.assists),
      csPerMin: csPerMin(g),
      dpm: dpm(g),
      // 라인전 지표: 맞라인 상대 대비 격차 평균 (맞라인이 특정된 판만)
      laneGames: g.diffGames,
      csDiffAvg: g.diffGames > 0 ? round1(g.csDiffSum / g.diffGames) : null,
      goldDiffAvg: g.diffGames > 0 ? Math.round(g.goldDiffSum / g.diffGames) : null,
      damageDiffAvg: g.diffGames > 0 ? Math.round(g.damageDiffSum / g.diffGames) : null,
    }))
    .sort((a, b) => b.games - a.games);

  return {
    totalGames: rows.length,
    wins: rows.filter((r) => r.win).length,
    champions,
    positions,
  };
}

/**
 * 그룹 내전 챔피언 티어리스트 (픽률/승률/밴률/보정점수)
 */
async function getChampionTierlist({ groupId, position = null, minGames = TIERLIST_MIN_GAMES_DEFAULT }) {
  const allRows = await models.match_player_stat.findAll({
    where: { groupId },
    raw: true,
  });
  const totalGames = new Set(allRows.map((r) => r.riotGameKey)).size;
  if (totalGames === 0) {
    return { totalGames: 0, minGames, champions: [] };
  }

  // 밴 집계 (통계 생성된 raw 전체 — 봇 match 매핑 여부와 무관)
  const rawRows = await models.lcu_game_raw.findAll({
    where: { groupId, statsProcessedAt: { [Op.ne]: null } },
    attributes: ['bansJson'],
    raw: true,
  });
  const banCounts = new Map();
  for (const row of rawRows) {
    let bans = [];
    try {
      bans = JSON.parse(row.bansJson) || [];
    } catch (e) {
      /* bansJson 파싱 실패 무시 */
    }
    for (const ban of bans) {
      if (ban.championId > 0) banCounts.set(ban.championId, (banCounts.get(ban.championId) || 0) + 1);
    }
  }

  const rows = position ? allRows.filter((r) => r.position === position) : allRows;
  const champGroups = aggregate(rows, (r) => r.championId);
  const filtered = [...champGroups.entries()].filter(([, g]) => g.games >= minGames);
  const names = await resolveChampionNames(filtered.map(([id]) => id));

  const champions = filtered
    .map(([championId, g]) => {
      // 표본 적은 챔프의 승률 뻥튀기 방지용 베이지안 보정 점수
      const score = ((g.wins + SCORE_SMOOTHING_GAMES * 0.5) / (g.games + SCORE_SMOOTHING_GAMES)) * 100;
      return {
        championId,
        championName: names[championId].name,
        championKoName: names[championId].koName,
        games: g.games,
        wins: g.wins,
        winRate: winRate(g),
        pickRate: round1((g.games / totalGames) * 100),
        banCount: banCounts.get(championId) || 0,
        banRate: round1(((banCounts.get(championId) || 0) / totalGames) * 100),
        kda: avgKda(g.kills, g.deaths, g.assists),
        score: round1(score),
      };
    })
    .sort((a, b) => b.score - a.score);

  return { totalGames, minGames, position: position || null, champions };
}

module.exports = { getUserInternalStats, getChampionTierlist };
