var express = require('express');
var router = express.Router();

router.get('/login', function(req, res, next) {
  res.render('token/login.html');
});

router.get('/token', function(req, res, next) {
  res.render('token/token.html');
});

router.post('/login', async function (req, res, next) {
  const body = req.body;
});


module.exports = router;