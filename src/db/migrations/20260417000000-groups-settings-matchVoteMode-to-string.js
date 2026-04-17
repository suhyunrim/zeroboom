// matchVoteMode: boolean → string ('off' | 'normal' | 'blind') 변환
module.exports = {
  up: async (queryInterface) => {
    // settings JSON 안의 matchVoteMode가 true인 그룹 → 'normal'로 변환
    await queryInterface.sequelize.query(`
      UPDATE \`groups\`
      SET settings = JSON_SET(settings, '$.matchVoteMode', 'normal')
      WHERE JSON_TYPE(JSON_EXTRACT(settings, '$.matchVoteMode')) = 'TRUE'
    `);
    // matchVoteMode가 false인 그룹 → 'off'로 변환
    await queryInterface.sequelize.query(`
      UPDATE \`groups\`
      SET settings = JSON_SET(settings, '$.matchVoteMode', 'off')
      WHERE JSON_TYPE(JSON_EXTRACT(settings, '$.matchVoteMode')) = 'FALSE'
    `);
  },

  down: async (queryInterface) => {
    // 롤백: 'normal' → true, 'off'/'blind' → false
    await queryInterface.sequelize.query(`
      UPDATE \`groups\`
      SET settings = JSON_SET(settings, '$.matchVoteMode', CAST(true AS JSON))
      WHERE JSON_UNQUOTE(JSON_EXTRACT(settings, '$.matchVoteMode')) = 'normal'
    `);
    await queryInterface.sequelize.query(`
      UPDATE \`groups\`
      SET settings = JSON_SET(settings, '$.matchVoteMode', CAST(false AS JSON))
      WHERE JSON_UNQUOTE(JSON_EXTRACT(settings, '$.matchVoteMode')) IN ('off', 'blind')
    `);
  },
};
