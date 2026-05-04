module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('tournament_matches', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      tournamentId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      round: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      bracketSlot: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      team1Id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      team2Id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      team1Score: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      team2Score: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      winnerTeamId: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      bestOf: {
        type: Sequelize.INTEGER,
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

    await queryInterface.addIndex('tournament_matches', ['tournamentId', 'round', 'bracketSlot'], {
      name: 'tournament_matches_tournament_round_slot',
      unique: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('tournament_matches');
  },
};
