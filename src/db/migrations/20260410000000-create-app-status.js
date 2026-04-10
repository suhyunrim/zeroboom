module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('app_status', {
      key: {
        type: Sequelize.STRING(50),
        primaryKey: true,
      },
      value: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('app_status');
  },
};
