module.exports = {
  up: async (queryInterface) => {
    const columns = await queryInterface.describeTable('tournament_scrims');
    if (columns.winnerTeamId) {
      await queryInterface.removeColumn('tournament_scrims', 'winnerTeamId');
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('tournament_scrims', 'winnerTeamId', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },
};
