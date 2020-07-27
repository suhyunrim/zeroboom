module.exports = (sequelize, DataTypes) => {
  const userChampionScore = sequelize.define(
    'userChampionScore',
    {
      groupId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
      },
      accountId: {
        type: DataTypes.STRING,
        primaryKey: true,
      },
      championId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
      },
      win: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      lose: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      kills: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      deaths: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      assists: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      doubleKills: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      tripleKills: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      quadraKills: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      pentaKills: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      visionScore: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      goldEarned: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      turretKills: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      totalMinionsKilled: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      neutralMinionsKilled: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      champLevel: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      visionWardsBoughtInGame: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      wardsPlaced: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      wardsKilled: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      gameDuration: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      totalDamageDealtToChampions: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      totalDamageTaken: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
    },
    {},
  );
  userChampionScore.associate = (/* models */) => {
    // associations can be defined here
  };
  return userChampionScore;
};
