module.exports = (sequelize, DataTypes) => {
  const tempVoiceGenerator = sequelize.define(
    'temp_voice_generator',
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
      guildId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      channelId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      categoryId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      defaultName: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '{username}의 채널',
      },
      defaultUserLimit: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {},
  );
  tempVoiceGenerator.associate = (/* models */) => {};
  return tempVoiceGenerator;
};
