module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('tournaments', 'bracketSize', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.changeColumn('tournaments', 'teamCount', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('tournaments', 'bracketSize', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });
    await queryInterface.changeColumn('tournaments', 'teamCount', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });
  },
};
