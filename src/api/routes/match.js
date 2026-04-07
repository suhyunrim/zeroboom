const { Router } = require('express');
const controller = require('../../controller/match');
const { verifyToken, requireGroupAdmin } = require('../middlewares/auth');

const route = Router();

module.exports = (app) => {
  app.use('/match', route);

  route.get('/history/:groupId', async (req, res) => {
    const { groupId } = req.params;
    const { page, limit, search } = req.query;
    const result = await controller.getMatchHistoryByGroupId(
      groupId,
      Number(page) || 1,
      Number(limit) || 20,
      search || null,
    );
    return res.status(result.status).json(result.result);
  });

  route.post('/:groupId/cancel', verifyToken, requireGroupAdmin, async (req, res) => {
    const { groupId } = req.params;
    const { matchId } = req.body;
    const result = await controller.cancelMatch(Number(groupId), Number(matchId));
    return res.status(result.status).json(result.result);
  });

  route.post('/:groupId/duplicate', verifyToken, requireGroupAdmin, async (req, res) => {
    const { groupId } = req.params;
    const { matchId, date, winTeam } = req.body;
    const result = await controller.duplicateMatch(Number(groupId), Number(matchId), date, Number(winTeam));
    return res.status(result.status).json(result.result);
  });
};
