module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('season_snapshots', {
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
      season: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      win: {
        type: Sequelize.INTEGER,
      },
      lose: {
        type: Sequelize.INTEGER,
      },
      defaultRating: {
        type: Sequelize.INTEGER,
      },
      additionalRating: {
        type: Sequelize.INTEGER,
      },
      discordId: {
        type: Sequelize.STRING,
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

    await queryInterface.addIndex('season_snapshots', ['groupId', 'puuid', 'season'], {
      unique: true,
      name: 'season_snapshots_group_puuid_season',
    });

    await queryInterface.addIndex('season_snapshots', ['groupId', 'season'], {
      name: 'season_snapshots_group_season',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('season_snapshots');
  },
};
