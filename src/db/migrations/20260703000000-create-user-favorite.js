module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('user_favorites', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      groupId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      ownerDiscordId: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      targetPuuid: {
        type: Sequelize.STRING,
        allowNull: false,
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

    await queryInterface.addIndex('user_favorites', ['groupId', 'ownerDiscordId', 'targetPuuid'], {
      name: 'user_favorites_owner_target_unique',
      unique: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('user_favorites');
  },
};
