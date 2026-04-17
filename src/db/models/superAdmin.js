module.exports = (sequelize, DataTypes) => {
  const superAdmin = sequelize.define(
    'super_admin',
    {
      discordId: {
        type: DataTypes.STRING(32),
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'super_admins',
    },
  );
  return superAdmin;
};
