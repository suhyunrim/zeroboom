import expressLoader from './express';
import sequelizeLoader from './sequelize';
import logger from './logger';

export default async (app) => {
  await sequelizeLoader();
  logger.info('✌️ DB loaded and connected!');

  await expressLoader(app);
  logger.info('✌️ Express loaded');
};
