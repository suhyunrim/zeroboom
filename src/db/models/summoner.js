module.exports = (sequelize, DataTypes) => {
  const summoner = sequelize.define(
    'summoner',
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
      puuid: {
        type: DataTypes.STRING,
      },
      name: {
        type: DataTypes.STRING,
      },
      simplifiedName: {
        type: DataTypes.STRING,
      },
      rankTier: {
        type: DataTypes.STRING,
      },
      rankWin: {
        type: DataTypes.INTEGER,
      },
      rankLose: {
        type: DataTypes.INTEGER,
      },
      profileIconId: {
        type: DataTypes.INTEGER,
      },
      revisionDate: {
        type: DataTypes.DATE,
      },
      summonerLevel: {
        type: DataTypes.INTEGER,
      },
      mainPosition: {
        type: DataTypes.STRING,
      },
      mainPositionRate: {
        type: DataTypes.FLOAT,
      },
      subPosition: {
        type: DataTypes.STRING,
      },
      subPositionRate: {
        type: DataTypes.FLOAT,
      },
      positionUpdatedAt: {
        type: DataTypes.DATE,
      },
    },
    {},
  );
  summoner.associate = (/* models */) => {
    // associations can be defined here
  };
  return summoner;
};
