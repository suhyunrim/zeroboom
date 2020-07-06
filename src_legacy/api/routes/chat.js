// const moment = require('moment');
const { Router } = require('express');
// const middlewares = require('../middlewares');

const route = Router();

module.exports = (app) => {
  app.use('/chats', route);

  route.get('/', async (req, res) => {
    return res.json({ test: 'test' }).status(200);
  });
};
