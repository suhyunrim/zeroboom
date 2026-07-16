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
    },
    {},
  );
  matchPlayerStat.associate = (/* models */) => {};
  return matchPlayerStat;
};
