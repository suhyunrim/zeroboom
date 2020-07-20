const express = require('express');
const router = express.Router();

const thresh = require('thresh');
const userController = require('../controller/user');

const { logger } = require('../loaders/logger');

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
    if (!loginCookies) return res.status(520);

    const decoededName = decodeURIComponent(loginCookies['PVPNET_ACCT_KR']);
    const accountId = loginCookies['PVPNET_ID_KR'];
    const token = loginCookies['id_token'];
    const loginResult = await userController.login(
      decoededName,
      accountId,
      token,
    );
    const groupList = await userController.getGroupList(accountId);
    return res.json({ loginResult, groupList }).status(loginResult.statusCode);
  } catch (e) {
    logger.error(e);
    return res.status(500);
  }
});

router.get('/getGroupList', async (req, res, next) => {
  const { accountId } = req.query;
  try {
    const groupList = await userController.getGroupList(accountId);
    return res.json(groupList.result).status(groupList.statusCode);
  } catch (e) {
    logger.error(e);
    return res.status(500);
  }
});

router.get('/getInfo', async (req, res, next) => {
  const { groupId, accountId } = req.query;
  try {
    const userInfo = await userController.getInfo(groupId, accountId);
    return res.json(userInfo.result).status(groupList.statusCode);
  } catch (e) {
    logger.error(e);
    return res.status(500);
  }
});

module.exports = router;
