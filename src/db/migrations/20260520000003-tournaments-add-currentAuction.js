module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('tournaments', 'currentAuctionPuuid', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('tournaments', 'currentAuctionDeadline', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('tournaments', 'currentAuctionDeadline');
    await queryInterface.removeColumn('tournaments', 'currentAuctionPuuid');
  },
};
