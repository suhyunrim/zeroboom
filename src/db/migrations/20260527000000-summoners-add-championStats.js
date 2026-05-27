module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('summoners', 'championStats', {
      type: Sequelize.JSON,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('summoners', 'championStats');
  },
};
