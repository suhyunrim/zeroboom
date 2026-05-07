module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('tournaments', 'trophyType', {
      type: Sequelize.STRING(50),
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('tournaments', 'trophyType');
  },
};
