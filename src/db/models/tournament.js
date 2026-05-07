module.exports = (sequelize, DataTypes) => {
  const tournament = sequelize.define(
    'tournament',
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
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'preparing',
      },
      bracketSize: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      teamCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      defaultBestOf: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 3,
      },
      finalBestOf: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 5,
      },
      championTeamId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      trophyType: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
    },
    {},
  );
  tournament.associate = (models) => {
    tournament.hasMany(models.tournament_team, {
      foreignKey: 'tournamentId',
      as: 'teams',
    });
    tournament.hasMany(models.tournament_match, {
      foreignKey: 'tournamentId',
      as: 'matches',
    });
  };
  return tournament;
};
