'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn('challenges', 'leaderboardSnapshot', {
      type: Sequelize.JSON,
      allowNull: true,
    });
  },

  down: (queryInterface) => {
    return queryInterface.removeColumn('challenges', 'leaderboardSnapshot');
  },
};
