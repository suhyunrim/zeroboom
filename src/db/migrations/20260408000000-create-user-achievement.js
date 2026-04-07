module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('user_achievements', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      groupId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      puuid: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      achievementId: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      unlockedAt: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex('user_achievements', ['groupId', 'puuid', 'achievementId'], {
      unique: true,
      name: 'user_achievements_unique',
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('user_achievements');
  },
};
