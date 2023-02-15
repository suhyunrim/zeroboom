const express = require('express');
const router = express.Router();

router.get('/get-match-history', function(req, res, next) {
  res.render('match-history/get-match-history.html');
});

module.exports = router;
