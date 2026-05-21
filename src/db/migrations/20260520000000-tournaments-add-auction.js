module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('tournaments', 'type', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'normal',
    });
    await queryInterface.addColumn('tournaments', 'auctionConfig', {
      type: Sequelize.JSON,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('tournaments', 'auctionConfig');
    await queryInterface.removeColumn('tournaments', 'type');
  },
};
