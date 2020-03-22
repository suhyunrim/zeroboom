const { Router } = require('express');
// const middlewares = require('../middlewares');
const route = Router();

module.exports = (app) => {
  app.use('/users', route);

  route.get('/me', (req, res) => {
    return res.json({ user: 'test_user' }).status(200);
  });
};
