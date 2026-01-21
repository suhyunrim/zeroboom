const { Router } = require('express');
const dashboardController = require('../../controller/dashboard');

const route = Router();

module.exports = (app) => {
  app.use('/dashboard', route);

  /**
   * GET /api/dashboard/:groupId
   * 그룹의 이번 달 대시보드 통계 조회
   */
  route.get('/:groupId', async (req, res) => {
    const { groupId } = req.params;

    if (!groupId || isNaN(groupId)) {
      return res.status(400).json({ result: 'invalid groupId', status: 400 });
    }

    const { result, status } = await dashboardController.getDashboardStats(Number(groupId));
    return res.status(status).json(result);
  });
};
