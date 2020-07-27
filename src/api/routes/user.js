const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const { registerUser } = require('../../services/user');
const thresh = require('thresh');
const route = Router();
const controller = require('../../controller/user');

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
      const loginResult = await controller.login(
        decoededName,
        accountId,
        token,
      );
      const groupList = await controller.getGroupList(accountId);
      return res
        .json({ loginResult, groupList })
        .status(loginResult.statusCode);
    } catch (e) {
      logger.error(e);
      return res.status(500);
    }
  });

  route.get('/getGroupList', async (req, res, next) => {
    const { accountId } = req.query;
    try {
      const groupList = await controller.getGroupList(accountId);
      return res.json(groupList.result).status(groupList.statusCode);
    } catch (e) {
      logger.error(e);
      return res.status(500);
    }
  });

  route.get('/getInfo', async (req, res, next) => {
    const { groupId, accountId } = req.query;
    try {
      const userInfo = await controller.getInfo(groupId, accountId);
      return res.json(userInfo.result).status(userInfo.statusCode);
    } catch (e) {
      logger.error(e);
      return res.status(500);
    }
  });

  route.post('/calculateChampionScore', async (req, res, next) => {
    const { groupId, accountId, tokenId } = req.body;
    try {
      const championScore = await controller.calculateChampionScore(
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
