const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const controller = require('../../controller/match');

const route = Router();

module.exports = (app) => {
  app.use('/match', route);

  route.post('/register', async (req, res) => {
    const { tokenId, summonerName } = req.body;
    const result = await controller.registerMatch(tokenId, summonerName);
    return res.status(result.status).json(result);
  });

  route.post('/calculate', async (req, res) => {
    const { groupName } = req.body;
    const ret = await controller.calculateRating(groupName);
    return res.json(ret);
  });

  route.post('/predict-winrate', async function(req, res, next) {
    const { groupName, team1, team2 } = req.body;

    const result = await controller.predictWinRate(
      groupName,
      team1.split(','),
      team2.split(','),
    );
    return res.status(result.status).json(result);
  });

  route.post('/generate-match', async function(req, res, next) {
    const { groupName, team1, team2, userPool } = req.body;

    const team1Array = team1 != '' ? team1.split(',') : [];
    const team2Array = team2 != '' ? team2.split(',') : [];
    const userPoolArray = userPool != '' ? userPool.split(',') : [];

    const result = await controller.generateMatch(
      groupName,
      team1Array,
      team2Array,
      userPoolArray,
    );
    return res.status(result.status).json(result);
  });
};
