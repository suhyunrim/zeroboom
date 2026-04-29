module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('profile_visits', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      targetPuuid: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      targetGroupId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      visitorDiscordId: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      visitDate: {
        type: Sequelize.DATEONLY,
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

    // 1인 1일 1카운트 보장
    await queryInterface.addIndex('profile_visits', ['targetPuuid', 'targetGroupId', 'visitorDiscordId', 'visitDate'], {
      unique: true,
      name: 'profile_visits_unique_daily',
    });
    await queryInterface.addIndex('profile_visits', ['targetPuuid', 'targetGroupId', 'visitDate'], {
      name: 'profile_visits_target_date',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('profile_visits');
  },
};
