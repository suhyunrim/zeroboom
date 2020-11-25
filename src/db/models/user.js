module.exports = (sequelize, DataTypes) => {
  const user = sequelize.define(
    'user',
    {
      riotId: {
        type: DataTypes.STRING,
        primaryKey: true,
      },
      accountId: {
        type: DataTypes.STRING,
      },
      encryptedAccountId: {
        type: DataTypes.STRING,
      },
      groupId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
      },
      win: {
        type: DataTypes.INTEGER,
      },
      lose: {
        type: DataTypes.INTEGER,
      },
      defaultRating: {
        type: DataTypes.INTEGER,
      },
      additionalRating: {
        type: DataTypes.INTEGER,
      },
      role: {
        type: DataTypes.STRING,
        defaultValue: 'member',
        allowNull: false,
      },
      latestMatchDate: {
        type: DataTypes.DATE,
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
