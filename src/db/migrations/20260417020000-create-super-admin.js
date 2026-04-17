module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('super_admins', {
      discordId: {
        type: Sequelize.STRING(32),
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      note: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('super_admins');
  },
};
