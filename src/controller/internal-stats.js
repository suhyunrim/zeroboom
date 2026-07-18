const { Op } = require('sequelize');
const models = require('../db/models');
const { resolveChampionNames } = require('../utils/champion-map');

const TIERLIST_MIN_GAMES_DEFAULT = 3; // 초기 데이터 확인용 1에서 상향 (표본 충분해지면 5로 복원)
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
        visionScore: 0,
        goldEarned: 0,
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
    g.visionScore += row.visionScore;
    g.goldEarned += row.goldEarned;
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
// 스크림(대회 팀 연습) 제외 조건 — null(미판정)은 정규 내전으로 취급
const notScrim = { [Op.or]: [{ isScrim: null }, { isScrim: false }] };

// 집계에 실제로 쓰는 컬럼만 조회 (아이템/스펠/룬/와드 등 상세 컬럼 ~25개 제외)
const AGGREGATE_ATTRS = [
  'riotGameKey', 'championId', 'position', 'win', 'teamNo',
  'kills', 'deaths', 'assists', 'cs', 'gameDurationSec',
  'damageToChampions', 'visionScore', 'goldEarned',
  'csDiff', 'goldDiff', 'damageDiff',
];

async function getUserInternalStats({ groupId, puuid }) {
  const rows = await models.match_player_stat.findAll({
    where: { groupId, puuid, ...notScrim },
    attributes: AGGREGATE_ATTRS,
    raw: true,
  });

  if (rows.length === 0) {
    return { totalGames: 0, wins: 0, champions: [], positions: [] };
  }

  // 팀 단위 분모 집계: 같은 게임에서 win 값이 같은 행 = 같은 팀 (총킬=킬관여, 총딜=딜비중)
  // 팀 오브젝트(에픽 몬스터) — 게임 길이에 무관한 획득률(내 팀 / 양팀 합) 계산용
  const gameKeys = [...new Set(rows.map((r) => r.riotGameKey))];
  const [teamRows, teamStatRows] = await Promise.all([
    models.match_player_stat.findAll({
      where: { riotGameKey: { [Op.in]: gameKeys } },
      attributes: ['riotGameKey', 'win', 'kills', 'damageToChampions'],
      raw: true,
    }),
    models.match_team_stat.findAll({
      where: { riotGameKey: { [Op.in]: gameKeys } },
      attributes: ['riotGameKey', 'teamNo', 'baronKills', 'dragonKills', 'riftHeraldKills', 'hordeKills'],
      raw: true,
    }),
  ]);
  const teamKillsByGame = new Map(); // `${gameKey}:${win}` → 팀 총킬
  const teamDamageByGame = new Map(); // `${gameKey}:${win}` → 팀 총딜
  for (const r of teamRows) {
    const key = `${r.riotGameKey}:${r.win ? 1 : 0}`;
    teamKillsByGame.set(key, (teamKillsByGame.get(key) || 0) + r.kills);
    teamDamageByGame.set(key, (teamDamageByGame.get(key) || 0) + r.damageToChampions);
  }
  const epicMonsters = (t) => t.baronKills + t.dragonKills + t.riftHeraldKills + t.hordeKills;
  const teamObjByGame = new Map(); // `${gameKey}:${teamNo}` → 에픽 몬스터 수
  for (const t of teamStatRows) {
    teamObjByGame.set(`${t.riotGameKey}:${t.teamNo}`, epicMonsters(t));
  }

  // 챔피언별 부가 집계: 포지션 최빈값 + 킬관여/딜비중/오브젝트 획득률 (분모 0인 판은 양쪽 모두 제외)
  const extras = new Map(); // championId → 부가 누적치
  for (const row of rows) {
    if (!extras.has(row.championId)) {
      extras.set(row.championId, {
        positionCounts: new Map(),
        kpKillsAssists: 0,
        kpTeamKills: 0,
        myDamage: 0,
        teamDamage: 0,
        myEpic: 0,
        totalEpic: 0,
      });
    }
    const e = extras.get(row.championId);
    if (row.position) {
      e.positionCounts.set(row.position, (e.positionCounts.get(row.position) || 0) + 1);
    }
    const teamKey = `${row.riotGameKey}:${row.win ? 1 : 0}`;
    const tk = teamKillsByGame.get(teamKey) || 0;
    if (tk > 0) {
      e.kpKillsAssists += row.kills + row.assists;
      e.kpTeamKills += tk;
    }
    const td = teamDamageByGame.get(teamKey) || 0;
    if (td > 0) {
      e.myDamage += row.damageToChampions;
      e.teamDamage += td;
    }
    if (row.teamNo) {
      const my = teamObjByGame.get(`${row.riotGameKey}:${row.teamNo}`);
      const enemy = teamObjByGame.get(`${row.riotGameKey}:${row.teamNo === 1 ? 2 : 1}`);
      if (my !== undefined && enemy !== undefined && my + enemy > 0) {
        e.myEpic += my;
        e.totalEpic += my + enemy;
      }
    }
  }
  const mainPositionOf = (e) => {
    let best = null;
    let bestCount = 0;
    for (const [pos, count] of e.positionCounts) {
      if (count > bestCount) {
        best = pos;
        bestCount = count;
      }
    }
    return best;
  };

  const champGroups = aggregate(rows, (r) => r.championId);
  const names = await resolveChampionNames([...champGroups.keys()]);
  const champions = [...champGroups.entries()]
    .map(([championId, g]) => {
      const e = extras.get(championId);
      return {
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
        // 포지션 맞춤 표시용 부가 지표
        mainPosition: mainPositionOf(e),
        dpm: dpm(g),
        visionPerMin: g.durationSec > 0 ? round1(g.visionScore / (g.durationSec / 60)) : 0,
        killParticipation: e.kpTeamKills > 0 ? round1((e.kpKillsAssists / e.kpTeamKills) * 100) : null,
        laneGoldDiffAvg: g.diffGames > 0 ? Math.round(g.goldDiffSum / g.diffGames) : null,
        // 공통: 팀 내 딜 비중(%) / 분당 골드
        damageShare: e.teamDamage > 0 ? round1((e.myDamage / e.teamDamage) * 100) : null,
        gpm: g.durationSec > 0 ? Math.round(g.goldEarned / (g.durationSec / 60)) : 0,
        // 정글: 에픽 몬스터(바론+용+전령+유충) 획득률 % — 스폰이 고정 타이밍이라 시간 환산 대신 양팀 합 대비
        objectiveShare: e.totalEpic > 0 ? round1((e.myEpic / e.totalEpic) * 100) : null,
      };
    })
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
    where: { groupId, ...notScrim },
    attributes: AGGREGATE_ATTRS,
    raw: true,
  });
  const totalGames = new Set(allRows.map((r) => r.riotGameKey)).size;
  if (totalGames === 0) {
    return { totalGames: 0, minGames, champions: [] };
  }

  // 밴 집계 (통계 생성된 raw 전체 — 봇 match 매핑 여부와 무관, 스크림 제외)
  // raw:true를 쓰지 않아 bansJson은 모델 getter가 파싱한다
  const rawRows = await models.lcu_game_raw.findAll({
    where: { groupId, statsProcessedAt: { [Op.ne]: null }, ...notScrim },
    attributes: ['bansJson'],
  });
  const banCounts = new Map();
  for (const row of rawRows) {
    for (const ban of row.bansJson) {
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
