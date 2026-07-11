module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('ai_chat_logs', 'inputTokens', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('ai_chat_logs', 'outputTokens', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('ai_chat_logs', 'thinkingTokens', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('ai_chat_logs', 'inputTokens');
    await queryInterface.removeColumn('ai_chat_logs', 'outputTokens');
    await queryInterface.removeColumn('ai_chat_logs', 'thinkingTokens');
  },
};
