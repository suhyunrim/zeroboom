module.exports = {
  up: async (queryInterface) => {
    // commentId가 PK 첫 컬럼이라 별도 인덱스가 redundant. drop.
    await queryInterface.removeIndex('comment_likes', 'comment_likes_commentId').catch(() => {});
  },

  down: async (queryInterface) => {
    await queryInterface.addIndex('comment_likes', ['commentId'], {
      name: 'comment_likes_commentId',
    });
  },
};
