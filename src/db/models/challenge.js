module.exports = (sequelize, DataTypes) => {
  const challenge = sequelize.define(
    'challenge',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      groupId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
      },
      gameType: {
        type: DataTypes.ENUM('soloRank', 'flexRank', 'aram', 'arena'),
        allowNull: false,
      },
      startAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      endAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      canceledAt: {
        type: DataTypes.DATE,
      },
      scoringType: {
        type: DataTypes.ENUM('games', 'wins', 'winRate', 'points'),
        defaultValue: 'points',
        allowNull: false,
      },
      isVisible: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      createdBy: {
        type: DataTypes.STRING,
      },
      displayOrder: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      lastSyncAt: {
        type: DataTypes.DATE,
      },
      leaderboardSnapshot: {
        type: DataTypes.JSON,
      },
      activePlayerCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
    },
    {},
  );
  challenge.associate = (/* models */) => {
    // associations can be defined here
  };
  return challenge;
};
