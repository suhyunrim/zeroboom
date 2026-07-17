module.exports = (sequelize, DataTypes) => {
  const tournamentScrim = sequelize.define(
    'tournament_scrim',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      tournamentId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      team1Id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      team2Id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      team1Score: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      team2Score: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      recordedByDiscordId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      riotGameKey: {
        type: DataTypes.STRING(32),
        allowNull: true, // 수집 게임 기반 자동 기록만 채움 (null=수동 기록)
      },
    },
    {},
  );
  tournamentScrim.associate = (/* models */) => {};
  return tournamentScrim;
};
