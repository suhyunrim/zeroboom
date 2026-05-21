module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('tournament_teams', 'remainingBudget', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('tournament_teams', 'remainingBudget');
  },
};
