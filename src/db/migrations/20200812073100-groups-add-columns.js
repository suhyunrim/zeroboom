'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.addColumn(
      'groups',
      'discordGuildId',
      Sequelize.STRING,
    );
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.removeColumn('summoners', 'discordGuildId');
  },
};
