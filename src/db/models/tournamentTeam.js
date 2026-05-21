module.exports = (sequelize, DataTypes) => {
  const tournamentTeam = sequelize.define(
    'tournament_team',
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
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      captainPuuid: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      members: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      remainingBudget: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      auctionBudget: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {},
  );
  tournamentTeam.associate = (/* models */) => {};
  return tournamentTeam;
};
