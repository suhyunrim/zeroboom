const { Router } = require('express');

const {
  get: getValidator,
  getByDiscordGuildId: getByDGValidator,
} = require('./validators');
const {
  get: getHandler,
  getByDiscordGuildId: getByDGHandler,
} = require('./handlers');

const route = Router();

module.exports = (app) => {
  app.use('/v2/groups', route);

  route.get('/:id', getValidator, getHandler);
  route.get('/discord-guild-id/:id', getByDGValidator, getByDGHandler);
};
