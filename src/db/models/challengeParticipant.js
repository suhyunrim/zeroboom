module.exports = (sequelize, DataTypes) => {
  const challengeParticipant = sequelize.define(
    'challenge_participant',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      challengeId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      puuid: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      lastSyncAt: {
        type: DataTypes.DATE,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ['challengeId', 'puuid'],
        },
      ],
    },
  );
  challengeParticipant.associate = (/* models */) => {
    // associations can be defined here
  };
  return challengeParticipant;
};
