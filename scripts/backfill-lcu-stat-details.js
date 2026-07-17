// 내전 수집 상세 지표 백필: 기존 lcu_game_raws의 원본 JSON을 재처리해
// match_player_stats(아이템/스펠/룬/멀티킬 등) + match_team_stats를 다시 생성한다.
// 기존 행을 지우고 processRaw를 다시 돌리므로 매핑(matchId)도 동일하게 복원된다.
// 사용: node scripts/backfill-lcu-stat-details.js
const models = require('../src/db/models');
const { processRaw } = require('../src/controller/lcu-collector');

(async () => {
  const raws = await models.lcu_game_raw.findAll({
    where: { statsProcessedAt: { [models.Sequelize.Op.ne]: null } },
    order: [['id', 'ASC']],
  });
  console.log(`재처리 대상 raw: ${raws.length}건`);

  let ok = 0;
  let failed = 0;
  for (const raw of raws) {
    try {
      await models.match_player_stat.destroy({ where: { riotGameKey: raw.riotGameKey } });
      await models.match_team_stat.destroy({ where: { riotGameKey: raw.riotGameKey } });
      const result = await processRaw(raw);
      console.log(
        `${raw.riotGameKey}: statsCreated=${result.statsCreated} mapped=${result.mapped}` +
          (result.matchId ? ` matchId=${result.matchId}` : ''),
      );
      ok += 1;
    } catch (e) {
      console.error(`${raw.riotGameKey}: 실패 - ${e.message}`);
      failed += 1;
    }
  }
  console.log(`완료: 성공 ${ok} / 실패 ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
