const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const { registerUser } = require('../../services/user');
const route = Router();
const userController = require('../../controller/user');
const groupController = require('../../controller/group');
const summonerController = require('../../controller/summoner');

module.exports = (app) => {
  app.use('/user', route);

  route.post('/register', async (req, res) => {
    const { groupName, summonerName } = req.body;
    let { tier } = req.body;

    var ret = await registerUser(groupName, summonerName, tier);
    return res.status(ret.status).json({ result: ret.result });
  });

  route.post('/login', async (req, res, next) => {
    const { riotId } = req.body;
    try {
      if (!riotId || !riotId.includes('#')) {
        return res.status(400).json({ result: 'riotId 형식이 올바르지 않습니다. (예: 닉네임#태그)' });
      }

      const summoner = await summonerController.getSummonerByName(riotId);
      if (!summoner || !summoner.result) {
        return res.status(404).json({ result: '소환사를 찾을 수 없습니다.' });
      }

      const puuid = summoner.result.puuid;
      const groupList = await userController.getGroupList(puuid);

      return res.status(200).json({
        puuid,
        name: riotId,
        groupList: groupList.result,
      });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.get('/getGroupList', async (req, res, next) => {
    try {
      const puuid = req.headers.puuid;
      if (!puuid) {
        return res.status(400).json({ result: 'puuid가 필요합니다.' });
      }
      const groupList = await userController.getGroupList(puuid);
      return res.status(groupList.status).json({ result: groupList.result });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.get('/getInfo', async (req, res, next) => {
    const { groupId } = req.query;
    try {
      const puuid = req.headers.puuid;
      if (!puuid) {
        return res.status(400).json({ result: 'puuid가 필요합니다.' });
      }
      const userInfo = await userController.getInfo(groupId, puuid);
      return res.status(userInfo.status).json({ result: userInfo.result });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.get('/getRating', async (req, res, next) => {
    const { groupName, userName } = req.query;
    try {
      const group = await groupController.getByName(groupName);
      const summoner = await summonerController.getSummonerByName(userName);
      const userInfo = await userController.getRating(group.id, summoner.result.puuid);
      return res.status(userInfo.status).json({ result: userInfo.result });
    } catch (e) {
      logger.error(e);
      return res.status(500);
    }
  });

  route.get('/getPosition', async (req, res, next) => {
    const { userName } = req.query;
    try {
      const positions = await summonerController.getPositions(userName);
      return res.status(positions.status).json({ result: positions.result });
    } catch (e) {
      logger.error(e);
      return res.status(500);
    }
  });
};
