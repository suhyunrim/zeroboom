/**
 * 전원 투표 보너스 소급 지급 스크립트
 *
 * grantFullVoteBonus 함수는 (gameId, voterPuuid) 유니크 인덱스 위반 때문에
 * 실제로 발동한 적이 없다. 도입(2026-02-18) 이후 전원 투표 달성 게임 3건에 대해
 * 보너스(참가자 전원 +1표)를 소급 지급한다.
 *
 * 대상 gameId: 1495, 1546, 1565 (전부 groupId=4, 롤최몇)
 *
 * 참가자는 honor_votes의 실제 voterPuuid로 추출 (10표 달성 게임이므로
 * 참가자 10명 = 투표자 10명이 보장됨).
 */
const mysql = require('mysql2/promise');

const TARGET_GAME_IDS = [1495, 1546, 1565];

(async () => {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3307,
    user: 'root',
    password: 'Eroboom!23',
    database: 'zeroboom_bot',
  });

  for (const gameId of TARGET_GAME_IDS) {
    await conn.beginTransaction();
    try {
      // 해당 게임의 기존 보너스 레코드 확인 (혹시 부분 삽입됐을 가능성 대비)
      const [existing] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM honor_votes WHERE gameId=? AND voterPuuid LIKE 'SYSTEM_BONUS%'`,
        [gameId],
      );
      if (existing[0].cnt > 0) {
        console.log(`[${gameId}] 이미 보너스 ${existing[0].cnt}건 존재 → 스킵`);
        await conn.rollback();
        continue;
      }

      // 실제 투표자(=참가자) 목록 추출
      const [voters] = await conn.query(
        `SELECT DISTINCT voterPuuid, groupId FROM honor_votes
         WHERE gameId=? AND voterPuuid NOT LIKE 'SYSTEM_BONUS%'`,
        [gameId],
      );

      if (voters.length !== 10) {
        console.log(`[${gameId}] 참가자 수 ${voters.length} ≠ 10 → 스킵 (수동 확인 필요)`);
        await conn.rollback();
        continue;
      }

      const groupId = voters[0].groupId;
      const now = new Date();

      const values = voters.map((v) => [
        gameId,
        groupId,
        `SYSTEM_BONUS:${v.voterPuuid}`,
        v.voterPuuid,
        0,
        now,
        now,
      ]);

      await conn.query(
        `INSERT INTO honor_votes (gameId, groupId, voterPuuid, targetPuuid, teamNumber, createdAt, updatedAt) VALUES ?`,
        [values],
      );

      await conn.commit();
      console.log(`[${gameId}] 보너스 ${voters.length}건 지급 완료 (groupId=${groupId})`);
    } catch (e) {
      await conn.rollback();
      console.error(`[${gameId}] 실패:`, e.message);
      throw e;
    }
  }

  // 검증
  const [verify] = await conn.query(
    `SELECT gameId, COUNT(*) AS bonus_cnt FROM honor_votes
     WHERE voterPuuid LIKE 'SYSTEM_BONUS%' GROUP BY gameId ORDER BY gameId`,
  );
  console.log('\n최종 SYSTEM_BONUS 레코드 현황:');
  console.table(verify);

  await conn.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
