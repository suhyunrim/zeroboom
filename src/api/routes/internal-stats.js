const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const models = require('../../db/models');
const internalStats = require('../../controller/internal-stats');
const { findGroupSummoner } = require('../../utils/summoner-lookup');

const userRoute = Router();
const championRoute = Router();

const VALID_POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

module.exports = (app) => {
  app.use('/user', userRoute);
  app.use('/champions', championRoute);

  /**
   * GET /api/user/internal-stats?groupId=&name= (또는 &puuid=)
   * 내전 챔피언 통계 + 포지션별 라인전 지표
   */
  userRoute.get('/internal-stats', async (req, res) => {
    try {
      const groupId = Number(req.query.groupId);
      if (!groupId) {
        return res.status(400).json({ result: 'groupId가 필요합니다.' });
      }

      let puuid = req.query.puuid;
      if (!puuid && req.query.name) {
        const summoner = await findGroupSummoner(models, groupId, { name: req.query.name });
        if (!summoner) {
          return res.status(404).json({ result: '해당 그룹에서 소환사를 찾을 수 없습니다.' });
        }
        puuid = summoner.puuid;
      }
      if (!puuid) {
        return res.status(400).json({ result: 'name 또는 puuid가 필요합니다.' });
      }

      const stats = await internalStats.getUserInternalStats({ groupId, puuid });
      return res.status(200).json({ result: { puuid, ...stats } });
    } catch (e) {
      logger.error(`[internal-stats] 유저 통계 조회 실패: ${e.message}`);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * GET /api/champions/tierlist?groupId=&position=&minGames=
   * 그룹 내전 챔피언 티어리스트
   */
  championRoute.get('/tierlist', async (req, res) => {
    try {
      const groupId = Number(req.query.groupId);
      if (!groupId) {
        return res.status(400).json({ result: 'groupId가 필요합니다.' });
      }

      const position = req.query.position ? String(req.query.position).toUpperCase() : null;
      if (position && !VALID_POSITIONS.includes(position)) {
        return res.status(400).json({ result: `position은 ${VALID_POSITIONS.join('/')} 중 하나여야 합니다.` });
      }

      const minGames = req.query.minGames ? Math.max(1, Number(req.query.minGames)) : undefined;

      const result = await internalStats.getChampionTierlist({ groupId, position, minGames });
      return res.status(200).json({ result });
    } catch (e) {
      logger.error(`[internal-stats] 티어리스트 조회 실패: ${e.message}`);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });
};
