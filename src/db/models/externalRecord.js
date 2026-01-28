module.exports = (sequelize, DataTypes) => {
  const externalRecord = sequelize.define(
    'externalRecord',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      puuid: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      groupId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      win: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      lose: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      description: {
        type: DataTypes.STRING,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {},
  );
  externalRecord.associate = (/* models */) => {
    // associations can be defined here
  };
  return externalRecord;
};
