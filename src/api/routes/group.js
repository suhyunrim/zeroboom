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
};
