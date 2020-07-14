const express = require('express');
const router = express.Router();

const thresh = require('thresh');
const matchController = require('../controller/match');

router.get('/login', function(req, res, next) {
  res.render('token/login.html');
});

router.get('/token', function(req, res, next) {
  res.render('token/token.html');
});

router.post('/login', async function (req, res, next) {
  const { id, password, summonerName } = req.body;
  const tokenId = await thresh.getLoginToken(id, password);
  const result = await matchController.registerMatch(tokenId, summonerName);
  return res.json(result).status(result.statusCode);
});

module.exports = router;