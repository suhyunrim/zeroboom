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
    },
    {},
  );
  tournamentScrim.associate = (/* models */) => {};
  return tournamentScrim;
};
