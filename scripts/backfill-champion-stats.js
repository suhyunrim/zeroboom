// 솔랭 모스트 챔피언(championStats) 백필.
// getPositions는 챔피언을 "새 매치"부터만 누적하므로, 기존 유저는 과거 표본이 비어 있다.
// 이 스크립트가 최신 DEPTH판을 한 번 긁어 championStats를 채우고, positionStats.lastMatchId를
// 최신으로 당겨 둔다. 이후 getPositions는 그보다 새 매치만 추가하므로 이중 카운트가 없다.
//
// 비파괴: 포지션 카운터(top/jungle/...)와 mainPosition은 건드리지 않는다 (lastMatchId만 갱신).
// 대상: 최근 WITHIN_DAYS일 내 활동 + positionStats.lastMatchId가 있는 유저 중 챔피언 표본이 부족한 경우.
//
// 사용법(서버에서, 프로덕션 Riot 키 + 운영 DB):
//   node scripts/backfill-champion-stats.js
//   DEPTH=300 TARGET=150 WITHIN_DAYS=60 FORCE=1 LIMIT=10 node scripts/backfill-champion-stats.js
require('dotenv').config();
const { Op } = require('sequelize');
const models = require('../src/db/models');
const { getMatchIdsFromPuuid, getMatchData } = require('../src/services/riot-api');

const SOLO_RANKED_QUEUE = 420;
const DEPTH = Number(process.env.DEPTH || 200); // 긁을 최신 솔랭 판 수
const TARGET = Number(process.env.TARGET || 100); // 이 판수 이상이면 스킵
const WITHIN_DAYS = Number(process.env.WITHIN_DAYS || 30);
// 라이브 봇과 Riot 키를 공유하므로 보수적으로(기존 코드 기준 최대치):
//  - 매치 간 2000ms: challenge.js 대량 동기화의 sleep(2000)
//  - 유저 간 3000ms: summoner.js 배치 delayBetweenSummoners 기본값
const MATCH_DELAY_MS = Number(process.env.MATCH_DELAY_MS || 2000);
const SUMMONER_DELAY_MS = Number(process.env.SUMMONER_DELAY_MS || 3000);
const FORCE = process.env.FORCE === '1';
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const championTotal = (cs) => {
  if (!cs || typeof cs !== 'object') return 0;
  return Object.values(cs).reduce((a, c) => a + (c.games || 0), 0);
};

const fetchSoloMatchIds = async (puuid, depth) => {
  const ids = [];
  for (let begin = 0; begin < depth; begin += 100) {
    const count = Math.min(100, depth - begin);
    // eslint-disable-next-line no-await-in-loop
    const page = await getMatchIdsFromPuuid(puuid, begin, count, SOLO_RANKED_QUEUE);
    if (!page || page.length === 0) break;
    ids.push(...page);
    if (page.length < count) break;
  }
  return ids;
};

(async () => {
  const cutoff = new Date(Date.now() - WITHIN_DAYS * 24 * 60 * 60 * 1000);
  const activeUsers = await models.user.findAll({
    where: { updatedAt: { [Op.gte]: cutoff } },
    attributes: ['puuid'],
    group: ['puuid'],
    raw: true,
  });
  const puuids = activeUsers.map((u) => u.puuid);
  const summoners = await models.summoner.findAll({ where: { puuid: puuids } });
  console.log(`대상 후보: 활동유저 ${puuids.length}명 / summoner ${summoners.length}건`);

  let done = 0;
  let skipped = 0;
  let processed = 0;
  for (const s of summoners) {
    if (LIMIT && processed >= LIMIT) break;

    const ps = s.positionStats;
    if (!ps || !ps.lastMatchId) { skipped += 1; continue; } // 포지션 미크롤 → 자연 누적에 맡김
    if (!FORCE && championTotal(s.championStats) >= TARGET) { skipped += 1; continue; }

    processed += 1;
    try {
      const ids = await fetchSoloMatchIds(s.puuid, DEPTH);
      if (ids.length === 0) {
        console.log(`[${s.name}] 솔랭 매치 없음 → 스킵`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(SUMMONER_DELAY_MS);
        continue;
      }

      const championStats = {};
      let ok = 0;
      let fail = 0;
      for (let i = 0; i < ids.length; i += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const matchData = await getMatchData(ids[i]);
          const p = matchData.info.participants.find((e) => e.puuid === s.puuid);
          if (p && p.championName) {
            if (!championStats[p.championName]) championStats[p.championName] = { games: 0, wins: 0 };
            championStats[p.championName].games += 1;
            if (p.win) championStats[p.championName].wins += 1;
            ok += 1;
          }
        } catch (e) {
          fail += 1;
        }
        if (i < ids.length - 1) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(MATCH_DELAY_MS);
        }
      }

      // championStats 새로 기록 + 커서를 최신으로 당겨 이후 getPositions와 겹치지 않게.
      // 포지션 카운터/ mainPosition은 그대로 둔다.
      const newPs = { ...ps, lastMatchId: ids[0] };
      await s.update({ championStats, positionStats: newPs });

      done += 1;
      const top = Object.entries(championStats).sort((a, b) => b[1].games - a[1].games)[0];
      console.log(`[${s.name}] ${ok}판 집계 (실패 ${fail}) → 모스트: ${top ? `${top[0]}(${top[1].games})` : '-'}`);
    } catch (e) {
      console.error(`[${s.name}] 실패: ${e.message}`);
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(SUMMONER_DELAY_MS);
  }

  console.log(`\n완료: 백필 ${done}건, 스킵 ${skipped}건`);
  await models.sequelize.close();
  process.exit(0);
})().catch((e) => {
  console.error('에러:', e);
  process.exit(1);
});
