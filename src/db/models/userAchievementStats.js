module.exports = (sequelize, DataTypes) => {
  const userAchievementStats = sequelize.define(
    'user_achievement_stats',
    {
      puuid: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
      },
      groupId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      statType: {
        type: DataTypes.STRING(50),
        allowNull: false,
        primaryKey: true,
      },
      value: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {},
  );
  return userAchievementStats;
};
