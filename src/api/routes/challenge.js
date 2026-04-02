const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const { verifyToken, requireGroupAdmin } = require('../middlewares/auth');
const challengeController = require('../../controller/challenge');

const route = Router();

module.exports = (app) => {
  app.use('/challenge', route);

  // ===== 관리자 API =====

  /**
   * POST /api/challenge/:groupId
   * 챌린지 생성 (관리자 전용)
   */
  route.post('/:groupId', verifyToken, requireGroupAdmin, async (req, res) => {
    const { groupId } = req.params;
    const { title, description, gameType, startAt, endAt, scoringType, isVisible, displayOrder } = req.body;

    if (!title || !gameType || !startAt || !endAt) {
      return res.status(400).json({ result: 'title, gameType, startAt, endAt는 필수입니다.' });
    }

    const validGameTypes = ['soloRank', 'flexRank', 'aram', 'arena'];
    if (!validGameTypes.includes(gameType)) {
      return res.status(400).json({ result: `유효하지 않은 gameType입니다. (${validGameTypes.join(', ')})` });
    }

    if (new Date(startAt) >= new Date(endAt)) {
      return res.status(400).json({ result: 'endAt는 startAt 이후여야 합니다.' });
    }

    const result = await challengeController.createChallenge(
      Number(groupId),
      { title, description, gameType, startAt, endAt, scoringType, isVisible, displayOrder },
      req.user.puuid,
    );
    return res.status(result.status).json({ result: result.result });
  });

  /**
   * PUT /api/challenge/:groupId/:challengeId
   * 챌린지 수정 (관리자 전용)
   */
  route.put('/:groupId/:challengeId', verifyToken, requireGroupAdmin, async (req, res) => {
    const { challengeId } = req.params;

    const result = await challengeController.updateChallenge(Number(challengeId), req.body);
    return res.status(result.status).json({ result: result.result });
  });

  /**
   * POST /api/challenge/:groupId/:challengeId/cancel
   * 챌린지 취소 (관리자 전용)
   */
  route.post('/:groupId/:challengeId/cancel', verifyToken, requireGroupAdmin, async (req, res) => {
    const { challengeId } = req.params;

    const result = await challengeController.cancelChallenge(Number(challengeId));
    return res.status(result.status).json({ result: result.result });
  });

  /**
   * GET /api/challenge/:groupId/admin/list
   * 챌린지 전체 목록 (관리자 전용, draft 포함)
   */
  route.get('/:groupId/admin/list', verifyToken, requireGroupAdmin, async (req, res) => {
    const { groupId } = req.params;
    const result = await challengeController.listChallenges(Number(groupId));
    return res.status(result.status).json({ result: result.result });
  });

  /**
   * GET /api/challenge/:groupId/admin/:challengeId
   * 챌린지 상세 조회 (관리자 전용)
   */
  route.get('/:groupId/admin/:challengeId', verifyToken, requireGroupAdmin, async (req, res) => {
    const { challengeId } = req.params;
    const result = await challengeController.getChallengeDetail(Number(challengeId));
    return res.status(result.status).json({ result: result.result });
  });

  // ===== 유저 API =====

  /**
   * GET /api/challenge/:groupId/list
   * 공개 챌린지 목록 조회
   */
  route.get('/:groupId/list', async (req, res) => {
    const { groupId } = req.params;
    const result = await challengeController.listVisibleChallenges(Number(groupId));
    return res.status(result.status).json({ result: result.result });
  });

  /**
   * GET /api/challenge/:groupId/:challengeId
   * 챌린지 상세 조회
   */
  route.get('/:groupId/:challengeId', async (req, res) => {
    const { challengeId } = req.params;
    const result = await challengeController.getChallengeDetail(Number(challengeId));
    return res.status(result.status).json({ result: result.result });
  });

  /**
   * POST /api/challenge/:groupId/:challengeId/join
   * 챌린지 참가
   */
  route.post('/:groupId/:challengeId/join', verifyToken, async (req, res) => {
    const { challengeId } = req.params;
    const { puuid } = req.user;

    if (!puuid) {
      return res.status(400).json({ result: 'puuid가 필요합니다.' });
    }

    const result = await challengeController.joinChallenge(Number(challengeId), puuid);
    return res.status(result.status).json({ result: result.result });
  });

  /**
   * DELETE /api/challenge/:groupId/:challengeId/join
   * 챌린지 참가 취소
   */
  route.delete('/:groupId/:challengeId/join', verifyToken, async (req, res) => {
    const { challengeId } = req.params;
    const { puuid } = req.user;

    const result = await challengeController.cancelJoin(Number(challengeId), puuid);
    return res.status(result.status).json({ result: result.result });
  });

  /**
   * GET /api/challenge/:groupId/:challengeId/leaderboard
   * 챌린지 리더보드
   */
  route.get('/:groupId/:challengeId/leaderboard', async (req, res) => {
    const { challengeId } = req.params;
    const result = await challengeController.getLeaderboard(Number(challengeId));
    return res.status(result.status).json({ result: result.result });
  });

  /**
   * GET /api/challenge/:groupId/:challengeId/my-stats
   * 내 챌린지 기록/순위 조회
   */
  route.get('/:groupId/:challengeId/my-stats', verifyToken, async (req, res) => {
    const { challengeId } = req.params;
    const { puuid } = req.user;

    const result = await challengeController.getMyStats(Number(challengeId), puuid);
    return res.status(result.status).json({ result: result.result });
  });

  /**
   * GET /api/challenge/:groupId/:challengeId/user/:puuid/matches
   * 챌린지 기간 내 특정 유저 전적 상세 (솔랭/자랭: 그룹 멤버 표시)
   */
  route.get('/:groupId/:challengeId/user/:puuid/matches', async (req, res) => {
    const { groupId, challengeId, puuid } = req.params;
    const result = await challengeController.getUserMatchHistory(Number(challengeId), puuid, Number(groupId));
    return res.status(result.status).json({ result: result.result });
  });

  /**
   * GET /api/challenge/:groupId/:challengeId/sync-status
   * 동기화 진행 상태 조회 (DB 조회 없음, 폴링용)
   */
  route.get('/:groupId/:challengeId/sync-status', (req, res) => {
    const { challengeId } = req.params;
    const result = challengeController.getSyncStatus(Number(challengeId));
    return res.status(result.status).json({ result: result.result });
  });

  /**
   * POST /api/challenge/:groupId/:challengeId/sync
   * 챌린지 전체 참가자 전적 갱신 (인증된 유저만)
   */
  route.post('/:groupId/:challengeId/sync', verifyToken, async (req, res) => {
    const { challengeId } = req.params;

    const result = await challengeController.syncChallengeMatches(Number(challengeId));
    return res.status(result.status).json({ result: result.result });
  });
};
