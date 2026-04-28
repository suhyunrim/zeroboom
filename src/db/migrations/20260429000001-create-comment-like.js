module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('comment_likes', {
      commentId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      likerDiscordId: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
      likerName: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('comment_likes', ['commentId'], {
      name: 'comment_likes_commentId',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('comment_likes');
  },
};
