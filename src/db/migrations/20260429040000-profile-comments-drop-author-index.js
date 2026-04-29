module.exports = {
  up: async (queryInterface) => {
    // authorDiscordId 단독 인덱스는 어떤 쿼리도 사용하지 않아 write 비용만 발생.
    await queryInterface.removeIndex('profile_comments', 'profile_comments_author').catch(() => {});
  },

  down: async (queryInterface) => {
    await queryInterface.addIndex('profile_comments', ['authorDiscordId'], {
      name: 'profile_comments_author',
    });
  },
};
