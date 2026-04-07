'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_achievement_stats', {
      puuid: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
      groupId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      statType: {
        type: Sequelize.STRING(50),
        allowNull: false,
        primaryKey: true,
      },
      value: {
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
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_achievement_stats');
  },
};
