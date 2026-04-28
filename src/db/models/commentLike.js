module.exports = (sequelize, DataTypes) => {
  const commentLike = sequelize.define(
    'comment_like',
    {
      commentId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      likerDiscordId: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
      },
      likerName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {},
  );
  commentLike.associate = (models) => {
    commentLike.belongsTo(models.profile_comment, {
      foreignKey: 'commentId',
      as: 'comment',
    });
  };
  return commentLike;
};
