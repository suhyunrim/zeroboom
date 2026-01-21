const { Router } = require('express');
const summoner = require('./routes/summoner');
const chat = require('./routes/chat');
const group = require('./routes/group');
const user = require('./routes/user');
const match = require('./routes/match');
const dashboard = require('./routes/dashboard');

// v2
const groupsV2 = require('./routes/v2/groups');

// guaranteed to get dependencies
module.exports = () => {
  const app = Router();
  summoner(app);
  chat(app);
  group(app);
  user(app);
  match(app);
  dashboard(app);

  //v2
  groupsV2(app);
  return app;
};
