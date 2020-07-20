const express = require('express');
const router = express.Router();

const thresh = require('thresh');
const loginController = require('../controller/login');

router.get('/login', function(req, res, next) {
  res.render('token/login.html');
});

router.get('/token', function(req, res, next) {
  res.render('token/token.html');
});

router.post('/login', async function(req, res, next) {
  const { id, password } = req.body;
  try {
    const loginCookies = await thresh.getLoginCookies(id, password);
    if (!loginCookies)
      return res.status(520);

    const decoededName = decodeURIComponent(loginCookies['PVPNET_ACCT_KR']);
    const loginResult = await loginController.login(decoededName, loginCookies['PVPNET_ID_KR'], loginCookies['id_token']);
    return res.json(loginResult.result).status(loginResult.statusCode);
  } catch (e) {
    console.log(e);
    return res.status(500);
  }
});

module.exports = router;
