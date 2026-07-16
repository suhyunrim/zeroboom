module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 승패 메시지(플랜 시 생성)의 위치를 저장 → 외부(수집기)에서 자동 확정 시 같은 메시지를 갱신
    await queryInterface.addColumn('matches', 'discordChannelId', {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
    await queryInterface.addColumn('matches', 'discordMessageId', {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('matches', 'discordChannelId');
    await queryInterface.removeColumn('matches', 'discordMessageId');
  },
};
