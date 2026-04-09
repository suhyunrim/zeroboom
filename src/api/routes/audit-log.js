const { Router } = require('express');
const auditLogController = require('../../controller/audit-log');
const { verifyToken, requireGroupAdmin } = require('../middlewares/auth');

const route = Router();

module.exports = (app) => {
  app.use('/audit-log', route);

  route.get('/:groupId', verifyToken, requireGroupAdmin, async (req, res) => {
    const { groupId } = req.params;
    const { page, limit, action } = req.query;
    const result = await auditLogController.getByGroupId(Number(groupId), {
      page: Number(page) || 1,
      limit: Number(limit) || 50,
      action: action || undefined,
    });
    return res.json(result);
  });
};
