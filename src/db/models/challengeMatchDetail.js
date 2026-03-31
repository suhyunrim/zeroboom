module.exports = (sequelize, DataTypes) => {
  const challengeMatchDetail = sequelize.define(
    'challenge_match_detail',
    {
      matchId: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },
      queueId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      gameCreation: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      participants: {
        type: DataTypes.TEXT('medium'),
        get() {
          const val = this.getDataValue('participants');
          return val ? JSON.parse(val) : null;
        },
        set(val) {
          this.setDataValue('participants', val ? JSON.stringify(val) : null);
        },
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          fields: ['queueId', 'gameCreation'],
        },
      ],
    },
  );
  challengeMatchDetail.associate = (/* models */) => {
    // associations can be defined here
  };
  return challengeMatchDetail;
};
