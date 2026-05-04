module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('tournament_teams', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      tournamentId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      captainPuuid: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      members: {
        type: Sequelize.JSON,
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

    await queryInterface.addIndex('tournament_teams', ['tournamentId'], {
      name: 'tournament_teams_tournamentId',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('tournament_teams');
  },
};
