import { sequelize } from '../db/models';

export default async () => {
  await sequelize.sync();
};
