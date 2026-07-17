const axios = require('axios');
const { logger } = require('../loaders/logger');

// Data Dragon 챔피언 ID → 이름 매핑 (메모리 캐시, 24시간 갱신)
let cache = null; // Map<number, { name, koName }>
let cachedAt = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function loadChampionMap() {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;
  try {
    const versions = (await axios.get('https://ddragon.leagueoflegends.com/api/versions.json')).data;
    const version = versions[0];
    const { data } = (
      await axios.get(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR/champion.json`)
    ).data;
    const map = new Map();
    for (const champ of Object.values(data)) {
      map.set(Number(champ.key), { name: champ.id, koName: champ.name });
    }
    cache = map;
    cachedAt = Date.now();
  } catch (e) {
    logger.error(`[champion-map] Data Dragon 조회 실패: ${e.message}`);
    if (!cache) cache = new Map(); // 실패 시 빈 맵 (이름은 ID 폴백)
  }
  return cache;
}

// championId → { name: 'Ornn', koName: '오른' } (미확인 ID는 ID 문자열 폴백)
async function resolveChampionNames(championIds) {
  const map = await loadChampionMap();
  const result = {};
  for (const id of championIds) {
    result[id] = map.get(Number(id)) || { name: String(id), koName: String(id) };
  }
  return result;
}

module.exports = { resolveChampionNames };
