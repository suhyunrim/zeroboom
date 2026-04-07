module.exports = {
  up: async (queryInterface) => {
    return queryInterface.removeColumn('voice_activities', 'totalDuration');
  },
  down: async (queryInterface, Sequelize) => {
    return queryInterface.addColumn('voice_activities', 'totalDuration', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
  },
};
