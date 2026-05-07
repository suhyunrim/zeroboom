module.exports = (sequelize, DataTypes) => {
  const tournamentMatchPrediction = sequelize.define(
    'tournament_match_prediction',
    {
      matchId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      userPuuid: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
      },
      predictedTeamId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {},
  );
  tournamentMatchPrediction.associate = (/* models */) => {};
  return tournamentMatchPrediction;
};
