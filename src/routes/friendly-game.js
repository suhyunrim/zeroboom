const express = require('express');
const router = express.Router();

router.get('/predict-winrate', function(req, res, next) {
  res.render('friendly-game/predict-winrate.html');
});

router.get('/generate-match', function(req, res, next) {
  res.render('friendly-game/generate-match.html');
});

module.exports = router;
