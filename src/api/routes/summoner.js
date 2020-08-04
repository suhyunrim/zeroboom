const { Router } = require('express');
const { celebrate, Joi, Segments } = require('celebrate');
const controller = require('../../controller/summoner');

const route = Router();

module.exports = (app) => {
  app.use('/summoners', route);

  route.get(
    '/name/:name',
    celebrate({
      [Segments.PARAMS]: Joi.object({
        name: Joi.string().required(),
      }),
    }),
    async (req, res) => {
      const result = await controller.getSummonerByName(req.params.name);
      res.status(result.status).json(result.result);
    },
  );
};
