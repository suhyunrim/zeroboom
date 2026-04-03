const { Router } = require('express');
const controller = require('../../controller/match');

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
};
