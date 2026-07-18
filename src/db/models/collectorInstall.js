module.exports = (sequelize, DataTypes) => {
  const collectorInstall = sequelize.define(
    'collector_install',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      installId: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      riotId: { type: DataTypes.STRING(64), allowNull: true },
      puuid: { type: DataTypes.STRING(128), allowNull: true },
      version: { type: DataTypes.STRING(32), allowNull: true },
      platform: { type: DataTypes.STRING(32), allowNull: true },
      appStartedAt: { type: DataTypes.DATE, allowNull: true },
      lastEventAt: { type: DataTypes.DATE, allowNull: true },
      lastHeartbeatAt: { type: DataTypes.DATE, allowNull: true },
      lcuConnected: { type: DataTypes.BOOLEAN, allowNull: true },
      lastScanAt: { type: DataTypes.DATE, allowNull: true },
      lastUploadAt: { type: DataTypes.DATE, allowNull: true },
      lastQuitAt: { type: DataTypes.DATE, allowNull: true },
      lastQuitReason: { type: DataTypes.STRING(32), allowNull: true },
      lastCrashAt: { type: DataTypes.DATE, allowNull: true },
      lastCrashMessage: { type: DataTypes.TEXT, allowNull: true },
    },
    {},
  );
  collectorInstall.associate = (/* models */) => {};
  return collectorInstall;
};
