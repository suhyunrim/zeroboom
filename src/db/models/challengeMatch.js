module.exports = (sequelize, DataTypes) => {
  const challengeMatch = sequelize.define(
    'challenge_match',
    {
      matchId: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },
      puuid: {
        type: DataTypes.STRING,
        primaryKey: true,
      },
      win: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          fields: ['puuid'],
        },
      ],
    },
  );
  challengeMatch.associate = (/* models */) => {
    // associations can be defined here
  };
  return challengeMatch;
};
