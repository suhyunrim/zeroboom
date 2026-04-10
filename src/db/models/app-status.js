module.exports = (sequelize, DataTypes) => {
  const appStatus = sequelize.define(
    'app_status',
    {
      key: {
        type: DataTypes.STRING(50),
        primaryKey: true,
      },
      value: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      timestamps: true,
      createdAt: false,
      updatedAt: 'updatedAt',
    },
  );
  return appStatus;
};
