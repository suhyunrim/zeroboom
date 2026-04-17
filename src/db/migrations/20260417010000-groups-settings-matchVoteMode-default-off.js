// matchVoteMode 미설정 그룹에 'off' 기본값 채우기
module.exports = {
  up: async (queryInterface) => {
    // settings가 null인 그룹 → settings 자체를 { matchVoteMode: 'off' }로 초기화
    await queryInterface.sequelize.query(`
      UPDATE \`groups\`
      SET settings = JSON_OBJECT('matchVoteMode', 'off')
      WHERE settings IS NULL
    `);
    // settings는 있으나 matchVoteMode 키가 없는 그룹 → 'off' 추가
    await queryInterface.sequelize.query(`
      UPDATE \`groups\`
      SET settings = JSON_SET(settings, '$.matchVoteMode', 'off')
      WHERE JSON_EXTRACT(settings, '$.matchVoteMode') IS NULL
    `);
  },

  down: async (queryInterface) => {
    // 롤백: matchVoteMode가 'off'인 항목 제거
    await queryInterface.sequelize.query(`
      UPDATE \`groups\`
      SET settings = JSON_REMOVE(settings, '$.matchVoteMode')
      WHERE JSON_UNQUOTE(JSON_EXTRACT(settings, '$.matchVoteMode')) = 'off'
    `);
  },
};
