const expressLoader = require('./express');
const sequelizeLoader = require('./sequelize');
const logger = require('./logger');

module.exports = async (app) => {
  await sequelizeLoader();
  logger.info('✌️ DB loaded and connected!');

  await expressLoader(app);
  logger.info('✌️ Express loaded');
};