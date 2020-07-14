const { Router } = require('express');
const { registerUser } = require('../../services/user');
const route = Router();

module.exports = (app) => {
  app.use('/user', route);

  route.post('/register', async (req, res) => {
    const { groupName, summonerName, tokenId } = req.body;
    let { tier } = req.body;

    var ret = await registerUser(groupName, summonerName, tier, tokenId);
    return res.json({ result: ret.result }).status(ret.status);
  });
};
