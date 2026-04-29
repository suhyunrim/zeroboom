module.exports = (sequelize, DataTypes) => {
  const notification = sequelize.define(
    'notification',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      recipientDiscordId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      groupId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      type: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      targetKey: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      actorDiscordId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      actorName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      payload: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      readAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {},
  );
  notification.associate = (/* models */) => {};
  return notification;
};
