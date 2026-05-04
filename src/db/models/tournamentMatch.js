module.exports = (sequelize, DataTypes) => {
  const tournamentMatch = sequelize.define(
    'tournament_match',
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
      round: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      bracketSlot: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      team1Id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      team2Id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      team1Score: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      team2Score: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      winnerTeamId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      bestOf: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {},
  );
  tournamentMatch.associate = (/* models */) => {};
  return tournamentMatch;
};
