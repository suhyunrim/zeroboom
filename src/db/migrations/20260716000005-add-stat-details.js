// 내전 수집 상세 지표 확장: 아이템/스펠/룬/멀티킬/와드 + 팀 오브젝트(match_team_stats)
// 전부 nullable — null = "미수집"(확장 전 수집분) 구분. 과거분은 raw 재처리로 백필 가능.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const col = (type = Sequelize.INTEGER) => ({ type, allowNull: true });
    const playerColumns = {
      teamNo: col(), // 인게임 팀 (1=블루/100, 2=레드/200)
      item0: col(),
      item1: col(),
      item2: col(),
      item3: col(),
      item4: col(),
      item5: col(),
      item6: col(), // 장신구
      spell1Id: col(),
      spell2Id: col(),
      runeKeystoneId: col(), // perk0
      runePrimaryStyleId: col(), // perkPrimaryStyle
      runeSubStyleId: col(), // perkSubStyle
      champLevel: col(),
      doubleKills: col(),
      tripleKills: col(),
      quadraKills: col(),
      pentaKills: col(),
      largestMultiKill: col(),
      largestKillingSpree: col(),
      firstBloodKill: col(Sequelize.BOOLEAN),
      wardsPlaced: col(),
      wardsKilled: col(),
      controlWardsBought: col(), // visionWardsBoughtInGame
    };
    for (const [name, def] of Object.entries(playerColumns)) {
      await queryInterface.addColumn('match_player_stats', name, def);
    }

    await queryInterface.createTable('match_team_stats', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      riotGameKey: { type: Sequelize.STRING(32), allowNull: false },
      groupId: { type: Sequelize.INTEGER, allowNull: false },
      matchId: { type: Sequelize.INTEGER, allowNull: true }, // 봇 match 매핑 시에만
      teamNo: { type: Sequelize.INTEGER, allowNull: false }, // 1=블루/100, 2=레드/200
      win: { type: Sequelize.BOOLEAN, allowNull: false },
      baronKills: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      dragonKills: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      riftHeraldKills: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      hordeKills: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 }, // 공허유충
      towerKills: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      inhibitorKills: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      firstBlood: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      firstTower: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      firstDragon: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }, // LCU 원본은 firstDargon 오타
      firstBaron: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      firstInhibitor: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      bansJson: { type: Sequelize.TEXT, allowNull: true }, // 이 팀의 밴 [{championId, pickTurn}]
      gameVersion: { type: Sequelize.STRING(32), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('match_team_stats', ['riotGameKey', 'teamNo'], {
      name: 'match_team_stats_game_team_unique',
      unique: true,
    });
    await queryInterface.addIndex('match_team_stats', ['matchId'], { name: 'match_team_stats_match' });
    await queryInterface.addIndex('match_team_stats', ['groupId'], { name: 'match_team_stats_group' });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('match_team_stats');
    const names = [
      'teamNo', 'item0', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6',
      'spell1Id', 'spell2Id', 'runeKeystoneId', 'runePrimaryStyleId', 'runeSubStyleId',
      'champLevel', 'doubleKills', 'tripleKills', 'quadraKills', 'pentaKills',
      'largestMultiKill', 'largestKillingSpree', 'firstBloodKill',
      'wardsPlaced', 'wardsKilled', 'controlWardsBought',
    ];
    for (const name of names) {
      await queryInterface.removeColumn('match_player_stats', name);
    }
  },
};
