const { Op } = require('sequelize');
const models = require('../db/models');

// 경매 매물 스카우팅용: 후보의 천생연분(같은 팀 승률 높은 동료) / 톰과제리(자주 만난 상대)를
// 그룹 전체 매치에서 계산한다. 그룹 단위 인메모리 캐시(단일 프로세스 가정) + TTL.
const TTL_MS = 10 * 60 * 1000;
const MIN_TEAMMATE_GAMES = 2; // 천생연분 후보 최소 합방 수 (1판 100% 방지)

const cache = new Map(); // groupId -> { at, map }

// 순수 함수: 매치 row(team1/team2 JSON 문자열, winTeam)와 outsider 집합으로 per-player 맵 생성.
const computeScout = (matchRows, outsiderSet = new Set()) => {
  const teammate = {}; // puuid -> { other -> { games, wins } }
  const opponent = {}; // puuid -> { other -> { games, wins } }  (wins = puuid 기준 승)

  const addTeammate = (a, b, won) => {
    if (!teammate[a]) teammate[a] = {};
    if (!teammate[a][b]) teammate[a][b] = { games: 0, wins: 0 };
    teammate[a][b].games += 1;
    if (won) teammate[a][b].wins += 1;
  };
  const addOpponent = (a, b, aWon) => {
    if (!opponent[a]) opponent[a] = {};
    if (!opponent[a][b]) opponent[a][b] = { games: 0, wins: 0 };
    opponent[a][b].games += 1;
    if (aWon) opponent[a][b].wins += 1;
  };

  for (const m of matchRows) {
    const t1 = JSON.parse(m.team1).map((p) => p[0]);
    const t2 = JSON.parse(m.team2).map((p) => p[0]);
    const w = m.winTeam;

    const within = (team, won) => {
      for (let i = 0; i < team.length; i += 1) {
        for (let j = 0; j < team.length; j += 1) {
          if (i !== j) addTeammate(team[i], team[j], won);
        }
      }
    };
    within(t1, w === 1);
    within(t2, w === 2);

    for (const a of t1) {
      for (const b of t2) {
        addOpponent(a, b, w === 1);
        addOpponent(b, a, w === 2);
      }
    }
  }

  const toEntry = (other, s) => ({
    puuid: other,
    games: s.games,
    wins: s.wins,
    losses: s.games - s.wins,
    winRate: Math.round((s.wins / s.games) * 100),
  });

  const map = {};
  const allPuuids = new Set([...Object.keys(teammate), ...Object.keys(opponent)]);
  for (const puuid of allPuuids) {
    if (outsiderSet.has(puuid)) continue;
    const tm = teammate[puuid] || {};
    const op = opponent[puuid] || {};

    // 천생연분: 합방 MIN_TEAMMATE_GAMES 이상 중 승률 높은 순(동률이면 합방 많은 순)
    const soulmates = Object.entries(tm)
      .filter(([other, s]) => !outsiderSet.has(other) && s.games >= MIN_TEAMMATE_GAMES)
      .map(([other, s]) => toEntry(other, s))
      .sort((a, b) => b.winRate - a.winRate || b.games - a.games);

    // 톰과제리: 가장 자주 만난 상대 순
    const nemeses = Object.entries(op)
      .filter(([other]) => !outsiderSet.has(other))
      .map(([other, s]) => toEntry(other, s))
      .sort((a, b) => b.games - a.games);

    map[puuid] = { soulmates, nemeses };
  }
  return map;
};

const buildScoutMap = async (groupId) => {
  const [matches, outsiders] = await Promise.all([
    models.match.findAll({
      where: { groupId, winTeam: { [Op.ne]: null } },
      attributes: ['team1', 'team2', 'winTeam'],
      raw: true,
    }),
    models.user.findAll({
      where: { groupId, role: 'outsider' },
      attributes: ['puuid'],
      raw: true,
    }),
  ]);
  const outsiderSet = new Set(outsiders.map((u) => u.puuid));
  return computeScout(matches, outsiderSet);
};

const getScoutMap = async (groupId) => {
  const hit = cache.get(groupId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;
  const map = await buildScoutMap(groupId);
  cache.set(groupId, { at: Date.now(), map });
  return map;
};

// 시작 시점에 캐시를 비동기로 미리 데운다(에러 무시). 시작 응답을 막지 않는다.
const warmScoutMap = (groupId) => {
  getScoutMap(groupId).catch(() => {});
};

module.exports = { getScoutMap, warmScoutMap, computeScout };
