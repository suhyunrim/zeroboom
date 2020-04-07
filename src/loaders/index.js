const expressLoader = require('./express');
const sequelizeLoader = require('./sequelize');
const socketioLoader = require('./socket.io');
const { logger } = require('./logger');

module.exports = async (app) => {
  await sequelizeLoader();
  logger.info('✌️ DB loaded and connected!');

  await expressLoader(app);
  logger.info('✌️ Express loaded');

  const server = await socketioLoader(app);
  logger.info('✌️ Socket.IO loaded');

  return server;
};
