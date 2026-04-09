module.exports = (sequelize, DataTypes) => {
  const auditLog = sequelize.define(
    'audit_log',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      groupId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      actorDiscordId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      actorName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      action: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      details: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      source: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'discord',
      },
    },
    {},
  );
  auditLog.associate = (/* models */) => {};
  return auditLog;
};
