const { Router } = require('express');
const summoner = require('./routes/summoner');
const chat = require('./routes/chat');
const group = require('./routes/group');
const user = require('./routes/user');
const match = require('./routes/match');
const dashboard = require('./routes/dashboard');
const externalRecord = require('./routes/external-record');
const honor = require('./routes/honor');
const auth = require('./routes/auth');
const blacklist = require('./routes/blacklist');

// v2
const groupsV2 = require('./routes/v2/groups');

// guaranteed to get dependencies
module.exports = () => {
  const app = Router();
  summoner(app);
  chat(app);
  blacklist(app);
  group(app);
  user(app);
  match(app);
  dashboard(app);
  externalRecord(app);
  honor(app);
  auth(app);

  // v2
  groupsV2(app);
  return app;
};
