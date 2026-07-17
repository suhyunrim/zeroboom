module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('collector_tokens', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      groupId: { type: Sequelize.INTEGER, allowNull: false },
      token: { type: Sequelize.STRING(64), allowNull: false },
      label: { type: Sequelize.STRING(64) }, // 발급 대상 메모 (예: "현수필 PC")
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('collector_tokens', ['token'], {
      name: 'collector_tokens_token_unique',
      unique: true,
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('collector_tokens');
  },
};
