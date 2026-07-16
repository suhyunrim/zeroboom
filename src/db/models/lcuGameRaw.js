module.exports = (sequelize, DataTypes) => {
  const lcuGameRaw = sequelize.define(
    'lcu_game_raw',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      riotGameKey: { type: DataTypes.STRING(32), allowNull: false },
      groupId: { type: DataTypes.INTEGER, allowNull: false },
      uploaderPuuid: { type: DataTypes.STRING(128), allowNull: false },
      gameCreation: { type: DataTypes.DATE, allowNull: false },
      gameDuration: { type: DataTypes.INTEGER, allowNull: false },
      gameVersion: { type: DataTypes.STRING(32) },
      mapId: { type: DataTypes.INTEGER },
      queueId: { type: DataTypes.INTEGER },
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
      rawJson: {
        type: DataTypes.TEXT('long'),
        allowNull: false,
        get() {
          const raw = this.getDataValue('rawJson');
          return raw ? JSON.parse(raw) : null;
        },
        set(val) {
          this.setDataValue('rawJson', JSON.stringify(val));
        },
      },
      mappedMatchId: { type: DataTypes.INTEGER, allowNull: true },
      statsProcessedAt: { type: DataTypes.DATE, allowNull: true }, // match_player_stats 생성 완료 시각 (매핑 여부와 별개)
    },
    {},
  );
  lcuGameRaw.associate = (/* models */) => {};
  return lcuGameRaw;
};
