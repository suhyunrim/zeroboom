module.exports = (sequelize, DataTypes) => {
  const voiceActivityDaily = sequelize.define(
    'voice_activity_daily',
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
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      duration: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ['discordId', 'guildId', 'date'],
        },
      ],
    },
  );
  voiceActivityDaily.associate = (/* models */) => {};
  return voiceActivityDaily;
};
