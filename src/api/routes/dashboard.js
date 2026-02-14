const { Router } = require('express');
const dashboardController = require('../../controller/dashboard');

const route = Router();

module.exports = (app) => {
  app.use('/dashboard', route);

  /**
   * GET /api/dashboard/:groupId?month=YYYY-MM
   * 그룹의 대시보드 통계 조회 (month 미지정 시 이번 달)
   */
  route.get('/:groupId', async (req, res) => {
    const { groupId } = req.params;
    const { month } = req.query;

    if (!groupId || isNaN(groupId)) {
      return res.status(400).json({ result: 'invalid groupId', status: 400 });
    }

    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ result: 'invalid month format (YYYY-MM)', status: 400 });
    }

    const { result, status } = await dashboardController.getDashboardStats(Number(groupId), month);
    return res.status(status).json(result);
  });
};
