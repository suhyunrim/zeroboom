'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'statusMessage', {
      type: Sequelize.STRING(200),
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'statusMessageUpdatedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('users', 'statusMessageUpdatedAt');
    await queryInterface.removeColumn('users', 'statusMessage');
  },
};
