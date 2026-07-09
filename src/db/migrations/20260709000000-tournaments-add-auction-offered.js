module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 경매에서 이번 패스에 이미 매물로 올라온 후보(유찰 포함) puuid 목록.
    // 유찰자를 패스가 끝날 때까지 다시 매물로 뽑지 않기 위한 런타임 상태.
    await queryInterface.addColumn('tournaments', 'auctionOfferedPuuids', {
      type: Sequelize.JSON,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('tournaments', 'auctionOfferedPuuids');
  },
};
