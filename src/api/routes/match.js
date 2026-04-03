const { Router } = require('express');
const { celebrate, Segments, Joi } = require('celebrate');
const controller = require('../../controller/match');

const route = Router();

module.exports = (app) => {
  app.use('/match', route);

  route.get(
    '/history/:groupId',
    celebrate({
      [Segments.PARAMS]: Joi.object({
        groupId: Joi.number().integer().required(),
      }),
      [Segments.QUERY]: Joi.object({
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).max(100).default(20),
        search: Joi.string().trim().max(50).allow('').optional(),
      }),
    }),
    async (req, res) => {
      const { groupId } = req.params;
      const { page, limit, search } = req.query;
      const result = await controller.getMatchHistoryByGroupId(groupId, Number(page) || 1, Number(limit) || 20, search || null);
      return res.status(result.status).json(result.result);
    },
  );
};
