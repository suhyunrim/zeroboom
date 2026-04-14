const { Router } = require('express');
const balanceReport = require('../../services/balance-report');

const route = Router();

module.exports = (app) => {
  app.use('/balance-report', route);

  /**
   * GET /api/balance-report/:groupId
   * 매칭 밸런스 리포트 조회
   * query: startDate, endDate (optional, YYYY-MM-DD)
   */
  route.get('/:groupId', async (req, res) => {
    try {
      const { groupId } = req.params;
      const { startDate, endDate } = req.query;
      const report = await balanceReport.generateReport(
        Number(groupId),
        startDate || null,
        endDate || null,
      );
      return res.status(200).json(report);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });
};
