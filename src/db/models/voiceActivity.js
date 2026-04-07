module.exports = (sequelize, DataTypes) => {
  const voiceActivity = sequelize.define(
    'voice_activity',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      discordId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      guildId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      lastJoinedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lastLeftAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      totalDuration: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ['discordId', 'guildId'],
        },
      ],
    },
  );
  voiceActivity.associate = (/* models */) => {};
  return voiceActivity;
};
