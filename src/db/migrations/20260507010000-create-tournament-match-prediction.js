module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('tournament_match_predictions', {
      matchId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      userPuuid: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
      predictedTeamId: {
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

    await queryInterface.addIndex('tournament_match_predictions', ['predictedTeamId'], {
      name: 'tournament_match_predictions_predicted_team',
    });
    await queryInterface.addIndex('tournament_match_predictions', ['userPuuid'], {
      name: 'tournament_match_predictions_user_puuid',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('tournament_match_predictions');
  },
};
