module.exports = {
  up: async (queryInterface) => {
    await queryInterface.removeColumn('tournament_scrims', 'winnerTeamId');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('tournament_scrims', 'winnerTeamId', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },
};
