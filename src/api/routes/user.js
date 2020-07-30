const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const { registerUser } = require('../../services/user');
const thresh = require('thresh');
const route = Router();
const userController = require('../../controller/user');
const tokenController = require('../../controller/token');

module.exports = (app) => {
  app.use('/user', route);

  route.post('/register', async (req, res) => {
    const { groupName, summonerName, tokenId } = req.body;
    let { tier } = req.body;

    var ret = await registerUser(groupName, summonerName, tier, tokenId);
    return res.json({ result: ret.result }).status(ret.status);
  });

  route.post('/login', async function(req, res, next) {
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
      return res
        .json({ loginResult: loginResult.result, groupList: groupList.result })
        .status(loginResult.statusCode);
    } catch (e) {
      logger.error(e);
      return res.status(500);
    }
  });

  route.get('/getGroupList', async (req, res, next) => {
    try {
      const accountId = await tokenController.getAccountId(
        req.headers.riottokenid,
      );
      if (!accountId) {
        return res.status(500);
      }

      const groupList = await userController.getGroupList(accountId);
      return res.json(groupList.result).status(groupList.statusCode);
    } catch (e) {
      logger.error(e);
      return res.status(500);
    }
  });

  route.get('/getInfo', async (req, res, next) => {
    const { groupId, accountId } = req.query;
    try {
      const userInfo = await userController.getInfo(groupId, accountId);
      return res.json(userInfo.result).status(userInfo.statusCode);
    } catch (e) {
      logger.error(e);
      return res.status(500);
    }
  });

  route.post('/calculateChampionScore', async (req, res, next) => {
    const { groupId, accountId, tokenId } = req.body;
    try {
      const championScore = await userController.calculateChampionScore(
        groupId,
        accountId,
        tokenId,
      );
      return res.json(championScore.result).status(championScore.statusCode);
    } catch (e) {
      logger.error(e);
      return res.status(500);
    }
  });
};
