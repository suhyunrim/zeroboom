module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('lcu_game_raws', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      riotGameKey: { type: Sequelize.STRING(32), allowNull: false }, // 예: KR_8294822545
      groupId: { type: Sequelize.INTEGER, allowNull: false },
      uploaderPuuid: { type: Sequelize.STRING(128), allowNull: false },
      gameCreation: { type: Sequelize.DATE, allowNull: false },
      gameDuration: { type: Sequelize.INTEGER, allowNull: false }, // 초
      gameVersion: { type: Sequelize.STRING(32) },
      mapId: { type: Sequelize.INTEGER },
      queueId: { type: Sequelize.INTEGER },
      bansJson: { type: Sequelize.TEXT }, // [{championId, teamId, pickTurn}]
      rawJson: { type: Sequelize.TEXT('long'), allowNull: false },
      mappedMatchId: { type: Sequelize.INTEGER, allowNull: true }, // matches.gameId (매핑 성공 시)
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('lcu_game_raws', ['riotGameKey'], {
      name: 'lcu_game_raws_riot_game_key_unique',
      unique: true,
    });
    await queryInterface.addIndex('lcu_game_raws', ['groupId', 'gameCreation'], {
      name: 'lcu_game_raws_group_creation',
    });
    await queryInterface.addIndex('lcu_game_raws', ['mappedMatchId'], {
      name: 'lcu_game_raws_mapped_match',
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('lcu_game_raws');
  },
};
