const express = require('express');
const router = express.Router();

router.get('/login', function(req, res, next) {
  res.render('token/login.html');
});

module.exports = router;
