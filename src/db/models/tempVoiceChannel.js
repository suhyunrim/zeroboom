module.exports = (sequelize, DataTypes) => {
  const tempVoiceChannel = sequelize.define(
    'temp_voice_channel',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      channelId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      guildId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      ownerDiscordId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      generatorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {},
  );
  tempVoiceChannel.associate = (/* models */) => {};
  return tempVoiceChannel;
};
