module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 부캐(primaryPuuid IS NOT NULL) 의 discordId 를 NULL 로 비움.
    // 본/부캐가 같은 (groupId, discordId) 를 공유해 findOne 시 부캐가 잡히는 버그를
    // 스키마 수준에서 제거하기 위함. 디스코드 인증은 primaryPuuid → 본캐로 우회.
    await queryInterface.sequelize.query(
      'UPDATE users SET discordId = NULL WHERE primaryPuuid IS NOT NULL',
    );

    // (groupId, discordId) UNIQUE — MySQL은 NULL 을 중복으로 보지 않으므로
    // 부캐(discordId=NULL)는 제약 없이 다수 존재 가능.
    await queryInterface.addIndex('users', ['groupId', 'discordId'], {
      name: 'uniq_group_discord',
      unique: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('users', 'uniq_group_discord').catch(() => {});
    // discordId 원복은 안전하게 자동 복원이 불가하므로 수동 보정 필요.
  },
};
