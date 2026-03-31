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
      championName: {
        type: DataTypes.STRING,
      },
      kills: {
        type: DataTypes.INTEGER,
      },
      deaths: {
        type: DataTypes.INTEGER,
      },
      assists: {
        type: DataTypes.INTEGER,
      },
      teamId: {
        type: DataTypes.INTEGER,
      },
      participants: {
        type: DataTypes.TEXT,
        get() {
          const val = this.getDataValue('participants');
          return val ? JSON.parse(val) : null;
        },
        set(val) {
          this.setDataValue('participants', val ? JSON.stringify(val) : null);
        },
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
