module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('notifications', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      recipientDiscordId: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      groupId: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      type: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      targetKey: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      actorDiscordId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      actorName: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      payload: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      readAt: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex('notifications', ['recipientDiscordId', 'createdAt'], {
      name: 'notifications_recipient_created',
    });
    await queryInterface.addIndex('notifications', ['recipientDiscordId', 'readAt'], {
      name: 'notifications_recipient_read',
    });
    await queryInterface.addIndex('notifications', ['recipientDiscordId', 'type', 'targetKey'], {
      name: 'notifications_recipient_group',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('notifications');
  },
};
