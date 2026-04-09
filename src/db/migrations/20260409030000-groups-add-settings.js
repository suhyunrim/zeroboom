module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('groups', 'settings', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: null,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('groups', 'settings');
  },
};
