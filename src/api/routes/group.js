const { Router } = require('express');
const models = require('../../db/models');

const route = Router();

module.exports = (app) => {
  app.use('/group', route);

  route.post('/register', async (req, res) => {
    const groupName = req.body.groupName;

    if (!groupName)
      return res.json({ result: "invalid group name" });

    await models.group.findOrCreate({ where: { groupName } }).then((rows) => {
      res.json({ result: rows[1] ? 'succeed' : 'already exist' });
    });
  });

  route.get('/ranking', async (req, res) => {
    const { groupName } = req.body;

    if (!groupName)
      return res.json({ result: 'invalid group name' });

    const group = await models.group.findOne({ where: { groupName } });
    if (!group)
      return res.json({ result: 'group is not exist'} );

    let users = await models.user.findAll({ where: { groupId: group.id } });
    users = users.filter(elem => elem.win + elem.lose >= 4);
    users.sort((a, b) => (b.defaultRating + b.additionalRating) - (a.defaultRating + a.additionalRating));

    const userIds = users.map((elem) => elem.riotId);
    const summoners = await models.summoner.findAll({ where: { riotId: userIds } });
    const summonerObj = summoners.reduce((obj, v) => {
      obj[v.riotId] = v;
      return obj;
    }, {});

    let result = users.map((elem) => {
      return {
        riotId: elem.riotId,
        rating: elem.defaultRating + elem.additionalRating,
        win: elem.win,
        lose: elem.lose,
        winRate: Math.ceil((elem.win / (elem.win + elem.lose)) * 100),
      }
    });

    result.forEach((user) => {
      user.name = summonerObj[user.riotId].name;
    });

    return res.json( { result: result });
  })
};
