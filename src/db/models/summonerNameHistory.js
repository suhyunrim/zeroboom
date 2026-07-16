module.exports = (sequelize, DataTypes) => {
  const summonerNameHistory = sequelize.define(
    'summoner_name_history',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      puuid: { type: DataTypes.STRING(128), allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false }, // 옛 닉네임 (gameName#tagLine)
      changedAt: { type: DataTypes.DATE, allowNull: false }, // 닉변 감지 시각 (이 시각까지 이 이름 소유)
    },
    {},
  );
  summonerNameHistory.associate = (/* models */) => {};
  return summonerNameHistory;
};
