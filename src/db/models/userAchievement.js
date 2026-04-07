module.exports = (sequelize, DataTypes) => {
  const userAchievement = sequelize.define(
    'user_achievement',
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
      puuid: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      achievementId: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      unlockedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ['groupId', 'puuid', 'achievementId'],
        },
      ],
    },
  );
  userAchievement.associate = (/* models */) => {};
  return userAchievement;
};
