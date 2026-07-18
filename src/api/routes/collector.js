const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const lcuCollector = require('../../controller/lcu-collector');
const auditLog = require('../../controller/audit-log');

const route = Router();

module.exports = (app) => {
  app.use('/collector', route);

  /**
   * POST /api/collector/games
   * elise 헬퍼가 LCU에서 수집한 커스텀 게임 원본을 업로드 (무설정 자동 인식)
   * Body: { uploaderPuuid, game }
   * 그룹은 참가자 puuid로 서버가 자동 판별 (별도 토큰/설정 불필요)
   */
  route.post('/games', async (req, res) => {
    try {
      // live/champSelect: 게임 도중 elise가 켜져 있던 판에만 실려 오는 선택 필드
      const { uploaderPuuid, game, live, champSelect } = req.body || {};
      if (!uploaderPuuid || !game || !game.gameId || !game.platformId) {
        return res.status(400).json({ result: 'uploaderPuuid와 game(gameId, platformId 포함)이 필요합니다.' });
      }
      if (game.gameType !== 'CUSTOM_GAME') {
        return res.status(400).json({ result: '커스텀 게임만 업로드할 수 있습니다.' });
      }

      const result = await lcuCollector.ingestGame({
        uploaderPuuid,
        game,
        live: live || null,
        champSelect: champSelect || null,
      });

      // dedup / 판별 실패 / 참가자 아님 → 재업로드 방지 위해 2xx로 응답 (elise가 완료 처리)
      if (result.status === 'duplicate') {
        return res.status(200).json({ result: 'duplicate', riotGameKey: result.riotGameKey });
      }
      if (result.status === 'skipped') {
        return res.status(200).json({ result: 'skipped', reason: result.reason, riotGameKey: result.riotGameKey });
      }
      if (result.status === 'rejected') {
        return res.status(200).json({ result: 'rejected', reason: result.reason });
      }

      auditLog.log({
        groupId: result.groupId,
        actorDiscordId: null,
        actorName: `collector(${uploaderPuuid})`,
        action: 'collector.game_upload',
        details: { riotGameKey: result.riotGameKey, uploaderPuuid, statsCreated: result.statsCreated, mapped: result.mapped, matchId: result.matchId },
        source: 'api',
      });

      // 내전 match와 매핑되면 사용자가 승패 버튼 누른 것과 동일하게 자동 확정
      // (winTeam 검증·이미 확정된 건 skip은 내부에서 처리). 응답을 막지 않도록 fire-and-forget.
      if (result.mapped && req.app.autoConfirmMatchWin) {
        req.app
          .autoConfirmMatchWin({ gameId: result.matchId, winTeam: result.winTeam })
          .catch((e) => logger.error(`[collector] 자동 승패확정 실패: ${e.message}`));
      }

      return res.status(201).json({
        result: 'created',
        riotGameKey: result.riotGameKey,
        groupId: result.groupId,
        statsCreated: result.statsCreated,
        mapped: result.mapped,
        matchId: result.matchId,
      });
    } catch (e) {
      logger.error(`[collector] 업로드 처리 실패: ${e.message}`);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });
};
