'use strict';
module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.createTable('summoners', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      riotId: {
        type: Sequelize.STRING
      },
      accountId: {
        type: Sequelize.STRING
      },
      puuid: {
        type: Sequelize.STRING
      },
      name: {
        type: Sequelize.STRING
      },
      profileIconId: {
        type: Sequelize.INTEGER
      },
      revisionDate: {
        type: Sequelize.DATE
      },
      summonerLevel: {
        type: Sequelize.INTEGER
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.dropTable('summoners');
  }
};
