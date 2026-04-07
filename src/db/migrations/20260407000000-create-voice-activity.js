module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('voice_activities', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      discordId: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      guildId: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      lastJoinedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      lastLeftAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      totalDuration: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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

    await queryInterface.addIndex('voice_activities', ['discordId', 'guildId'], {
      unique: true,
      name: 'voice_activities_discordId_guildId_unique',
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('voice_activities');
  },
};
