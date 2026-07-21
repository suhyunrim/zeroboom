const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const lcuCollector = require('../../controller/lcu-collector');
const collectorTelemetry = require('../../controller/collector-telemetry');
const auditLog = require('../../controller/audit-log');
const { verifyToken } = require('../middlewares/auth');

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
        // 중복이라도 기존 raw의 빈 live/champSelect를 채웠으면 기록을 남긴다
        if (result.merged && result.merged.length) {
          auditLog.log({
            groupId: result.groupId,
            actorDiscordId: null,
            actorName: `collector(${uploaderPuuid})`,
            action: 'collector.live_backfill',
            details: { riotGameKey: result.riotGameKey, uploaderPuuid, merged: result.merged },
            source: 'api',
          });
        }
        return res.status(200).json({ result: 'duplicate', riotGameKey: result.riotGameKey, merged: result.merged || [] });
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

  /**
   * POST /api/collector/telemetry
   * elise 수집기의 생존/종료/크래시 신호. 게임 업로드와 달리 신원이 없을 때도 와야 하므로
   * 클라가 만든 installId로 식별한다 (LCU를 본 적 있으면 riotId/puuid가 함께 온다).
   * Body: { installId, version, platform, riotId, puuid, events: [{ type, reason, message, occurredAt, ... }] }
   */
  route.post('/telemetry', async (req, res) => {
    try {
      const { installId, version, platform, riotId, puuid, events } = req.body || {};
      const result = await collectorTelemetry.recordEvents({
        installId,
        version,
        platform,
        riotId,
        puuid,
        events,
      });
      if (result.status === 'rejected') {
        return res.status(400).json({ result: 'installId가 필요합니다.' });
      }
      return res.status(200).json({ result: 'ok', accepted: result.accepted });
    } catch (e) {
      logger.error(`[collector] 텔레메트리 처리 실패: ${e.message}`);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /** GET /api/collector/installs — 설치별 수집기 상태 (running|quit|crashed|stale) */
  route.get('/installs', verifyToken, async (req, res) => {
    try {
      return res.json({ installs: await collectorTelemetry.listInstalls() });
    } catch (e) {
      logger.error(`[collector] 설치 상태 조회 실패: ${e.message}`);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /** GET /api/collector/telemetry/events?installId=&limit= — 이벤트 이력 */
  route.get('/telemetry/events', verifyToken, async (req, res) => {
    try {
      const events = await collectorTelemetry.listEvents({
        installId: req.query.installId,
        limit: req.query.limit,
      });
      return res.json({ events });
    } catch (e) {
      logger.error(`[collector] 텔레메트리 이력 조회 실패: ${e.message}`);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });
};
