'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn('challenges', 'activePlayerCount', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
    });
  },

  down: (queryInterface) => {
    return queryInterface.removeColumn('challenges', 'activePlayerCount');
  },
};
