module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('voice_activity_dailies', {
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
      date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      duration: {
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

    await queryInterface.addIndex('voice_activity_dailies', ['discordId', 'guildId', 'date'], {
      unique: true,
      name: 'voice_activity_dailies_unique',
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('voice_activity_dailies');
  },
};
