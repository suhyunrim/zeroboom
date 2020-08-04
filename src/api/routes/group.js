const { Router } = require('express');
const models = require('../../db/models');

const route = Router();

const groupController = require('../../controller/group');
const matchController = require('../../controller/match');

const redis = require('../../redis/redis');
const redisKeys = require('../../redis/redisKeys');

module.exports = (app) => {
  app.use('/group', route);

  route.post('/register', async (req, res) => {
    const groupName = req.body.groupName;
    if (!groupName) return res.json({ result: 'invalid group name' });

    const result = await groupController.registerGroup(groupName);
    return res.json({ result: result.result }).status(result.status);
  });

  route.post('/retrieve-match', async (req, res) => {
    const groupName = req.body.groupName;
    if (!groupName) return res.json({ result: 'invalid group name' });

    const result = await groupController.retrieveMatches(groupName);
    return res.json({ result: result.result }).status(result.status);
  });

  route.get('/ranking', async (req, res) => {
    const { groupName } = req.query;

    if (!groupName) return res.json({ result: 'invalid group name' });

    const rankings = await groupController.getRanking(groupName);
    return res.json({ result: rankings.result, status: rankings.status });
  });

  route.post('/refresh-rating', async (req, res) => {
    const groupName = req.body.groupName;
    if (!groupName) return res.json({ result: 'invalid group name' });

    const redisFieldKey = groupName;
    const isRefreshing = await redis.hgetAsync(
      redisKeys.REFRESHING_GROUP_RATING,
      redisFieldKey,
    );

    if (isRefreshing) {
      return res.json({ result: 'already refreshing' }).status(501);
    }

    redis.hset(redisKeys.REFRESHING_GROUP_RATING, redisFieldKey, '1');

    const retrieveResult = await groupController.retrieveMatches(groupName);
    if (retrieveResult.status !== 200)
      return res.json({ result: 'retrieve match failed' }).status(501);

    const calculateResult = await matchController.calculateRating(groupName);
    if (calculateResult.status !== 200)
      return res.json({ result: 'calculate match failed' }).status(501);

    redis.hdel(redisKeys.REFRESHING_GROUP_RATING, redisFieldKey);

    return res.json({ result: calculateResult.result }).status(200);
  });
};
