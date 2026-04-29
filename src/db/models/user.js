module.exports = (sequelize, DataTypes) => {
  const user = sequelize.define(
    'user',
    {
      puuid: {
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
      discordId: {
        type: DataTypes.STRING,
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
      firstMatchDate: {
        type: DataTypes.DATE,
      },
      revisionDate: {
        type: DataTypes.DATE,
      },
      primaryPuuid: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      leftGuildAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      statusMessage: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      statusMessageUpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {},
  );
  user.associate = (/* models */) => {
    // associations can be defined here
  };
  return user;
};
