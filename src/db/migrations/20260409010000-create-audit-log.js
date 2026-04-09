module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('audit_logs', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      groupId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      actorDiscordId: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      actorName: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      action: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      details: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      source: {
        type: Sequelize.STRING(10),
        allowNull: false,
        defaultValue: 'discord',
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

    await queryInterface.addIndex('audit_logs', ['groupId', 'createdAt'], {
      name: 'audit_logs_groupId_createdAt',
    });
    await queryInterface.addIndex('audit_logs', ['action'], {
      name: 'audit_logs_action',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('audit_logs');
  },
};
