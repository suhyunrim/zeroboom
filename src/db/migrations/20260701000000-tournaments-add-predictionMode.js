module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('tournaments', 'predictionMode', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'bracket',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('tournaments', 'predictionMode');
  },
};
