module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('tournaments', 'heldAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    // 기존 토너먼트는 createdAt의 KST 날짜 자정으로 백필한다.
    // DB는 UTC로 저장되므로 createdAt을 KST로 변환 → 날짜만 추출 → 다시 UTC로 환산.
    // (예: 2026-05-10 KST 자정 = 2026-05-09 15:00:00 UTC)
    await queryInterface.sequelize.query(`
      UPDATE tournaments
      SET heldAt = CONVERT_TZ(DATE(CONVERT_TZ(createdAt, '+00:00', '+09:00')), '+09:00', '+00:00')
      WHERE heldAt IS NULL
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('tournaments', 'heldAt');
  },
};
