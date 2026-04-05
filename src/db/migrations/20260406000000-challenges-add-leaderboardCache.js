module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.addColumn('challenges', 'leaderboardCache', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: null,
    });
  },
  down: async (queryInterface) => {
    return queryInterface.removeColumn('challenges', 'leaderboardCache');
  },
};
