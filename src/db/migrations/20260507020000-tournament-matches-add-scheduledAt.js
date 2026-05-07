module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('tournament_matches', 'scheduledAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('tournament_matches', 'scheduledAt');
  },
};
