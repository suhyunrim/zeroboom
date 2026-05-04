module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('tournament_scrims', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      tournamentId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      team1Id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      team2Id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      team1Score: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      team2Score: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      winnerTeamId: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      recordedByDiscordId: {
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

    await queryInterface.addIndex('tournament_scrims', ['tournamentId', 'createdAt'], {
      name: 'tournament_scrims_tournament_created',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('tournament_scrims');
  },
};
