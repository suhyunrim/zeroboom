module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('profile_comments', 'parentId', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addIndex('profile_comments', ['parentId'], {
      name: 'profile_comments_parentId',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('profile_comments', 'profile_comments_parentId');
    await queryInterface.removeColumn('profile_comments', 'parentId');
  },
};
