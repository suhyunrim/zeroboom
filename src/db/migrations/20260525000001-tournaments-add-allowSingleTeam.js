module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('tournaments', 'allowSingleTeam', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('tournaments', 'allowSingleTeam');
  },
};
