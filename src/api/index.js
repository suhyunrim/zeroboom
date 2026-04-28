const { Router } = require('express');
const summoner = require('./routes/summoner');
const group = require('./routes/group');
const user = require('./routes/user');
const dashboard = require('./routes/dashboard');
const honor = require('./routes/honor');
const auth = require('./routes/auth');
const blacklist = require('./routes/blacklist');
const challenge = require('./routes/challenge');
const match = require('./routes/match');
const achievement = require('./routes/achievement');
const tempVoice = require('./routes/temp-voice');
const auditLog = require('./routes/audit-log');
const balanceReport = require('./routes/balance-report');
const profile = require('./routes/profile');

// v2
const groupsV2 = require('./routes/v2/groups');

// guaranteed to get dependencies
module.exports = () => {
  const app = Router();
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  summoner(app);
  blacklist(app);
  group(app);
  user(app);
  dashboard(app);
  honor(app);
  auth(app);
  challenge(app);
  match(app);
  achievement(app);
  tempVoice(app);
  auditLog(app);
  balanceReport(app);
  profile(app);

  // v2
  groupsV2(app);
  return app;
};
