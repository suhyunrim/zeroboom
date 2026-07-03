module.exports = (sequelize, DataTypes) => {
  // 대시보드 즐겨찾기 — 로그인 유저(ownerDiscordId)가 그룹 내 멤버(targetPuuid, 본캐)를 북마크.
  const userFavorite = sequelize.define(
    'user_favorite',
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
      ownerDiscordId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      targetPuuid: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    },
    {},
  );
  userFavorite.associate = (/* models */) => {};
  return userFavorite;
};
