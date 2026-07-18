module.exports = (sequelize, DataTypes) => {
  const collectorTelemetryEvent = sequelize.define(
    'collector_telemetry_event',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      installId: { type: DataTypes.STRING(64), allowNull: false },
      type: { type: DataTypes.STRING(24), allowNull: false },
      reason: { type: DataTypes.STRING(32), allowNull: true },
      version: { type: DataTypes.STRING(32), allowNull: true },
      riotId: { type: DataTypes.STRING(64), allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: true },
      occurredAt: { type: DataTypes.DATE, allowNull: false },
    },
    {},
  );
  collectorTelemetryEvent.associate = (/* models */) => {};
  return collectorTelemetryEvent;
};
