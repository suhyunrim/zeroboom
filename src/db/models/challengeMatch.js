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
      queueId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      win: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
      },
      gameCreation: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          fields: ['puuid', 'queueId', 'gameCreation'],
        },
      ],
    },
  );
  challengeMatch.associate = (/* models */) => {
    // associations can be defined here
  };
  return challengeMatch;
};
