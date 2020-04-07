const { Router } = require('express');
const summoner = require('./routes/summoner');
const chat = require('./routes/chat');

// guaranteed to get dependencies
module.exports = () => {
  const app = Router();
  summoner(app);
  chat(app);

  return app;
};
