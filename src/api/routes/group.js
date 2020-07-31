const { Router } = require('express');
const models = require('../../db/models');

const route = Router();

const controller = require('../../controller/group');

module.exports = (app) => {
  app.use('/group', route);

  route.post('/register', async (req, res) => {
    const groupName = req.body.groupName;
    if (!groupName) return res.json({ result: 'invalid group name' });

    const result = await controller.registerGroup(groupName);
    return res.json({ result: result.result }).status(result.status);
  });

  route.post('/retrieve-match', async (req, res) => {
    const groupName = req.body.groupName;
    if (!groupName) return res.json({ result: 'invalid group name' });

    const result = await controller.retrieveMatches(groupName);
    return res.json({ result: result.result }).status(result.status);
  });

  route.get('/ranking', async (req, res) => {
    const { groupName } = req.query;

    if (!groupName) return res.json({ result: 'invalid group name' });

    const rankings = await controller.getRanking(groupName);
    return res.json({ result: rankings.result, status: rankings.status });
  });
};
