import fs from 'fs';
import path from 'path';
import Sequelize from 'sequelize';

import config from '../../config/db';
import { logger } from '../../loaders/logger';

const db = {};
const sequelize = new Sequelize(config[process.env.NODE_ENV]);
const basename = path.basename(__filename);

sequelize.options.logging = logger.debug.bind(logger);

fs.readdirSync(__dirname)
  .filter((file) => {
    return (
      file.indexOf('.') !== 0 && file !== basename && file.slice(-3) === '.js'
    );
  })
  .forEach((file) => {
    const model = sequelize.import(path.join(__dirname, file));
    db[model.name] = model;
  });

Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
