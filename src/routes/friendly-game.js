const express = require('express');
const router = express.Router();

const matchController = require('../controller/match');

router.get('/predict-winrate', function(req, res, next) {
  res.render('friendly-game/predict-winrate.html');
});

router.post('/predict-winrate', async function (req, res, next) {
  const { groupName, team1, team2 } = req.body;

  const result = await matchController.predictWinRate(groupName, team1.split(','), team2.split(','));
  return res.json(result).status(result.statusCode);
});

module.exports = router;