module.exports = (sequelize, DataTypes) => {
  const matchTeamStat = sequelize.define(
    'match_team_stat',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      riotGameKey: { type: DataTypes.STRING(32), allowNull: false },
      groupId: { type: DataTypes.INTEGER, allowNull: false },
      matchId: { type: DataTypes.INTEGER, allowNull: true }, // 봇 match 매핑 시에만
      teamNo: { type: DataTypes.INTEGER, allowNull: false }, // 1=블루/100, 2=레드/200
      win: { type: DataTypes.BOOLEAN, allowNull: false },
      baronKills: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      dragonKills: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      riftHeraldKills: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      hordeKills: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, // 공허유충
      towerKills: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      inhibitorKills: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      firstBlood: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      firstTower: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      firstDragon: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      firstBaron: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      firstInhibitor: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      bansJson: {
        type: DataTypes.TEXT,
        get() {
          const raw = this.getDataValue('bansJson');
          return raw ? JSON.parse(raw) : [];
        },
        set(val) {
          this.setDataValue('bansJson', JSON.stringify(val || []));
        },
      },
      gameVersion: { type: DataTypes.STRING(32), allowNull: true },
    },
    {},
  );
  matchTeamStat.associate = (/* models */) => {};
  return matchTeamStat;
};
