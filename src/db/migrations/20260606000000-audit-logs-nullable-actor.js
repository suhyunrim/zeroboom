module.exports = {
  // 시스템/자동 액션(탈퇴 강등, 스크립트 정정 등)은 디스코드 actor가 없는 게 정상이라
  // actorDiscordId를 nullable로 변경한다. 기존엔 NOT NULL이라 해당 감사 로그가
  // insert 단계에서 조용히 실패해 유실되고 있었다.
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('audit_logs', 'actorDiscordId', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('audit_logs', 'actorDiscordId', {
      type: Sequelize.STRING,
      allowNull: false,
    });
  },
};
