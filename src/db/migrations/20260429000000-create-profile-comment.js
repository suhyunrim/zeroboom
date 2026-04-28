module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('profile_comments', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      targetPuuid: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      targetGroupId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      authorDiscordId: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      authorName: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      isSecret: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      deletedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    await queryInterface.addIndex('profile_comments', ['targetPuuid', 'targetGroupId', 'createdAt'], {
      name: 'profile_comments_target_created',
    });
    await queryInterface.addIndex('profile_comments', ['authorDiscordId'], {
      name: 'profile_comments_author',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('profile_comments');
  },
};
