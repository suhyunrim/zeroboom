module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('match_player_stats', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      matchId: { type: Sequelize.INTEGER, allowNull: false }, // matches.gameId
      riotGameKey: { type: Sequelize.STRING(32), allowNull: false },
      groupId: { type: Sequelize.INTEGER, allowNull: false },
      seasonId: { type: Sequelize.INTEGER, allowNull: true },
      puuid: { type: Sequelize.STRING(128), allowNull: false },
      position: { type: Sequelize.STRING(16), allowNull: true }, // TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY
      championId: { type: Sequelize.INTEGER, allowNull: false },
      kills: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      deaths: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      assists: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      cs: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 }, // 미니언+정글몹
      goldEarned: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      damageToChampions: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      damageTaken: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      visionScore: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      gameDurationSec: { type: Sequelize.INTEGER, allowNull: false },
      win: { type: Sequelize.BOOLEAN, allowNull: false },
      laneOpponentPuuid: { type: Sequelize.STRING(128), allowNull: true },
      csDiff: { type: Sequelize.INTEGER, allowNull: true }, // 본인 - 맞라인 상대
      goldDiff: { type: Sequelize.INTEGER, allowNull: true },
      damageDiff: { type: Sequelize.INTEGER, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('match_player_stats', ['riotGameKey', 'puuid'], {
      name: 'match_player_stats_game_player_unique',
      unique: true,
    });
    await queryInterface.addIndex('match_player_stats', ['groupId', 'puuid'], {
      name: 'match_player_stats_group_player',
    });
    await queryInterface.addIndex('match_player_stats', ['groupId', 'championId'], {
      name: 'match_player_stats_group_champion',
    });
    await queryInterface.addIndex('match_player_stats', ['matchId'], {
      name: 'match_player_stats_match',
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('match_player_stats');
  },
};
