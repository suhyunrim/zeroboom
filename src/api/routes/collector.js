const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const models = require('../../db/models');
const lcuCollector = require('../../controller/lcu-collector');
const auditLog = require('../../controller/audit-log');

const route = Router();

module.exports = (app) => {
  app.use('/collector', route);

  /**
   * POST /api/collector/games
   * elise 헬퍼가 LCU에서 수집한 커스텀 게임 원본을 업로드
   * Headers: X-Collector-Token
   * Body: { uploaderPuuid, game }
   */
  route.post('/games', async (req, res) => {
    try {
      const token = req.headers['x-collector-token'];
      if (!token) {
        return res.status(401).json({ result: '수집 토큰이 필요합니다.' });
      }
      const tokenRow = await models.collector_token.findOne({ where: { token, active: true } });
      if (!tokenRow) {
        return res.status(401).json({ result: '유효하지 않은 수집 토큰입니다.' });
      }

      const { uploaderPuuid, game } = req.body || {};
      if (!uploaderPuuid || !game || !game.gameId || !game.platformId) {
        return res.status(400).json({ result: 'uploaderPuuid와 game(gameId, platformId 포함)이 필요합니다.' });
      }
      if (game.gameType !== 'CUSTOM_GAME') {
        return res.status(400).json({ result: '커스텀 게임만 업로드할 수 있습니다.' });
      }

      const result = await lcuCollector.ingestGame({
        groupId: tokenRow.groupId,
        uploaderPuuid,
        game,
      });

      if (result.status === 'duplicate') {
        return res.status(200).json({ result: 'duplicate', riotGameKey: result.riotGameKey });
      }

      auditLog.log({
        groupId: tokenRow.groupId,
        actorDiscordId: null,
        actorName: `collector(${tokenRow.label || tokenRow.id})`,
        action: 'collector.game_upload',
        details: { riotGameKey: result.riotGameKey, uploaderPuuid, mapped: result.mapped, matchId: result.matchId },
        source: 'api',
      });

      return res.status(201).json({
        result: 'created',
        riotGameKey: result.riotGameKey,
        mapped: result.mapped,
        matchId: result.matchId,
      });
    } catch (e) {
      logger.error(`[collector] 업로드 처리 실패: ${e.message}`);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });
};
