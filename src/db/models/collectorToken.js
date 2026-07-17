module.exports = (sequelize, DataTypes) => {
  const collectorToken = sequelize.define(
    'collector_token',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      groupId: { type: DataTypes.INTEGER, allowNull: false },
      token: { type: DataTypes.STRING(64), allowNull: false },
      label: { type: DataTypes.STRING(64) },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {},
  );
  collectorToken.associate = (/* models */) => {};
  return collectorToken;
};
