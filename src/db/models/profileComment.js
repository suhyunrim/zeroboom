module.exports = (sequelize, DataTypes) => {
  const profileComment = sequelize.define(
    'profile_comment',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      targetPuuid: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      targetGroupId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      authorDiscordId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      authorName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      isSecret: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      parentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      paranoid: true,
    },
  );
  profileComment.associate = (models) => {
    profileComment.hasMany(models.comment_like, {
      foreignKey: 'commentId',
      as: 'likes',
    });
    profileComment.hasMany(models.profile_comment, {
      foreignKey: 'parentId',
      as: 'replies',
    });
  };
  return profileComment;
};
