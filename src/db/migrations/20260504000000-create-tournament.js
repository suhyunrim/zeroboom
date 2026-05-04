module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('tournaments', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      groupId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'preparing',
      },
      bracketSize: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      teamCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      defaultBestOf: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 3,
      },
      finalBestOf: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 5,
      },
      championTeamId: {
        type: Sequelize.INTEGER,
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

    await queryInterface.addIndex('tournaments', ['groupId', 'status'], {
      name: 'tournaments_groupId_status',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('tournaments');
  },
};
