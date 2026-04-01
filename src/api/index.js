const { Router } = require('express');
const summoner = require('./routes/summoner');
const group = require('./routes/group');
const user = require('./routes/user');
const dashboard = require('./routes/dashboard');
const honor = require('./routes/honor');
const auth = require('./routes/auth');
const blacklist = require('./routes/blacklist');
const challenge = require('./routes/challenge');

// v2
const groupsV2 = require('./routes/v2/groups');

// guaranteed to get dependencies
module.exports = () => {
  const app = Router();
  summoner(app);
  blacklist(app);
  group(app);
  user(app);
  dashboard(app);
  honor(app);
  auth(app);
  challenge(app);

  // v2
  groupsV2(app);
  return app;
};
