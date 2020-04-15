module.exports = (sequelize, DataTypes) => {
  const user = sequelize.define(
    'user',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      riotId: {
        type: DataTypes.STRING,
      },
      groupId: {
        type: DataTypes.INTEGER,
      },
      rating: {
        type: DataTypes.INTEGER,
      },
      revisionDate: {
        type: DataTypes.DATE,
      },
    },
    {},
  );
  user.associate = (/* models */) => {
    // associations can be defined here
  };
  return user;
};
