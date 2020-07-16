module.exports = (sequelize, DataTypes) => {
  const token = sequelize.define(
    'token',
    {
      accountId: {
        type: DataTypes.STRING,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
      },
      token: {
        type: DataTypes.STRING(1024),
      },
    },
    {},
  );
  token.associate = (/* models */) => {
    // associations can be defined here
  };
  return token;
};
