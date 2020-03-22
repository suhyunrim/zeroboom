const { database } = require('./index');

module.exports = {
  development: database,
  test: database,
  production: database,
};
