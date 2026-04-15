module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('matches', 'seasonId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.addIndex('matches', ['groupId', 'seasonId'], {
      name: 'matches_group_season',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('matches', 'matches_group_season');
    await queryInterface.removeColumn('matches', 'seasonId');
  },
};
