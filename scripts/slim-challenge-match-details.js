/**
 * 기존 challenge_match_details 레코드의 participants JSON에서 `challenges` 필드 제거.
 * Riot 세부 메트릭 데이터로 내전/챌린지 컨텐츠에 사용되지 않음. 매치당 ~4KB (약 50%) 감소.
 *
 * 실행:
 *   DATABASE_NAME=zeroboom_bot_test ... node scripts/slim-challenge-match-details.js --dry-run
 *   DATABASE_NAME=zeroboom_bot      ... node scripts/slim-challenge-match-details.js
 */
require('dotenv').config();
const models = require('../src/db/models');

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

(async () => {
  try {
    const total = await models.challenge_match_detail.count();
    console.log(`DATABASE_NAME=${process.env.DATABASE_NAME}, DRY_RUN=${DRY_RUN}, total rows: ${total}`);

    let processed = 0;
    let skipped = 0;
    let updated = 0;
    let bytesBefore = 0;
    let bytesAfter = 0;

    let offset = 0;
    while (offset < total) {
      const rows = await models.challenge_match_detail.findAll({
        attributes: ['matchId', 'participants'],
        order: [['matchId', 'ASC']],
        offset,
        limit: BATCH_SIZE,
        raw: true,
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        processed += 1;
        let participants;
        try {
          participants = typeof row.participants === 'string'
            ? JSON.parse(row.participants)
            : row.participants;
        } catch {
          skipped += 1;
          continue;
        }
        if (!Array.isArray(participants)) { skipped += 1; continue; }

        const hasChallenges = participants.some((p) => p && p.challenges != null);
        if (!hasChallenges) { skipped += 1; continue; }

        const slim = participants.map(({ challenges, ...rest }) => rest);

        const beforeStr = JSON.stringify(participants);
        const afterStr = JSON.stringify(slim);
        bytesBefore += beforeStr.length;
        bytesAfter += afterStr.length;

        if (!DRY_RUN) {
          await models.challenge_match_detail.update(
            { participants: slim },
            { where: { matchId: row.matchId } },
          );
        }
        updated += 1;
      }

      offset += rows.length;
      if (processed % 500 === 0 || offset >= total) {
        console.log(`  진행: ${processed}/${total} (updated=${updated}, skipped=${skipped})`);
      }
    }

    console.log('\n=== 결과 ===');
    console.log(`처리: ${processed} / 업데이트${DRY_RUN ? ' (예정)' : ''}: ${updated} / 스킵(이미 슬림): ${skipped}`);
    const mbBefore = (bytesBefore / 1024 / 1024).toFixed(2);
    const mbAfter = (bytesAfter / 1024 / 1024).toFixed(2);
    const saved = ((bytesBefore - bytesAfter) / 1024 / 1024).toFixed(2);
    const pct = bytesBefore > 0 ? ((1 - bytesAfter / bytesBefore) * 100).toFixed(1) : '0';
    console.log(`participants JSON: ${mbBefore} MB → ${mbAfter} MB (−${saved} MB, −${pct}%)`);
    console.log('완료');
    process.exit(0);
  } catch (e) {
    console.error('오류:', e);
    process.exit(1);
  }
})();
