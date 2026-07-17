module.exports = (sequelize, DataTypes) => {
  const matchPlayerStat = sequelize.define(
    'match_player_stat',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      matchId: { type: DataTypes.INTEGER, allowNull: true }, // 봇 match 매핑 시에만 채워짐 (수동 커스텀은 null)
      riotGameKey: { type: DataTypes.STRING(32), allowNull: false },
      groupId: { type: DataTypes.INTEGER, allowNull: false },
      seasonId: { type: DataTypes.INTEGER, allowNull: true },
      puuid: { type: DataTypes.STRING(128), allowNull: false },
      position: { type: DataTypes.STRING(16), allowNull: true },
      championId: { type: DataTypes.INTEGER, allowNull: false },
      kills: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      deaths: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      assists: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      cs: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      goldEarned: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      damageToChampions: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      damageTaken: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      visionScore: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      gameDurationSec: { type: DataTypes.INTEGER, allowNull: false },
      win: { type: DataTypes.BOOLEAN, allowNull: false },
      laneOpponentPuuid: { type: DataTypes.STRING(128), allowNull: true },
      csDiff: { type: DataTypes.INTEGER, allowNull: true },
      goldDiff: { type: DataTypes.INTEGER, allowNull: true },
      damageDiff: { type: DataTypes.INTEGER, allowNull: true },
      // 상세 지표 (null = 확장 전 수집분)
      teamNo: { type: DataTypes.INTEGER, allowNull: true }, // 1=블루/100, 2=레드/200
      item0: { type: DataTypes.INTEGER, allowNull: true },
      item1: { type: DataTypes.INTEGER, allowNull: true },
      item2: { type: DataTypes.INTEGER, allowNull: true },
      item3: { type: DataTypes.INTEGER, allowNull: true },
      item4: { type: DataTypes.INTEGER, allowNull: true },
      item5: { type: DataTypes.INTEGER, allowNull: true },
      item6: { type: DataTypes.INTEGER, allowNull: true },
      spell1Id: { type: DataTypes.INTEGER, allowNull: true },
      spell2Id: { type: DataTypes.INTEGER, allowNull: true },
      runeKeystoneId: { type: DataTypes.INTEGER, allowNull: true },
      runePrimaryStyleId: { type: DataTypes.INTEGER, allowNull: true },
      runeSubStyleId: { type: DataTypes.INTEGER, allowNull: true },
      champLevel: { type: DataTypes.INTEGER, allowNull: true },
      doubleKills: { type: DataTypes.INTEGER, allowNull: true },
      tripleKills: { type: DataTypes.INTEGER, allowNull: true },
      quadraKills: { type: DataTypes.INTEGER, allowNull: true },
      pentaKills: { type: DataTypes.INTEGER, allowNull: true },
      largestMultiKill: { type: DataTypes.INTEGER, allowNull: true },
      largestKillingSpree: { type: DataTypes.INTEGER, allowNull: true },
      firstBloodKill: { type: DataTypes.BOOLEAN, allowNull: true },
      wardsPlaced: { type: DataTypes.INTEGER, allowNull: true },
      wardsKilled: { type: DataTypes.INTEGER, allowNull: true },
      controlWardsBought: { type: DataTypes.INTEGER, allowNull: true },
      isScrim: { type: DataTypes.BOOLEAN, allowNull: true }, // null=미판정, true=대회 팀 스크림 (내전 통계 제외)
    },
    {},
  );
  matchPlayerStat.associate = (/* models */) => {};
  return matchPlayerStat;
};
