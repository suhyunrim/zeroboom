const { Router } = require('express');
const summoner = require('./routes/summoner');
const chat = require('./routes/chat');
const group = require('./routes/group')
const user = require('./routes/user')

// guaranteed to get dependencies
module.exports = () => {
  const app = Router();
  summoner(app);
  chat(app);
  group(app);
  user(app);

  return app;
};
