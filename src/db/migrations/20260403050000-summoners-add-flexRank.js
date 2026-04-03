'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('summoners', 'flexRankTier', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('summoners', 'flexRankWin', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('summoners', 'flexRankLose', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('summoners', 'flexRankTier');
    await queryInterface.removeColumn('summoners', 'flexRankWin');
    await queryInterface.removeColumn('summoners', 'flexRankLose');
  },
};
