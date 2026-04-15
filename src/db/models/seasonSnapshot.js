module.exports = (sequelize, DataTypes) => {
  const seasonSnapshot = sequelize.define(
    'season_snapshot',
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
      puuid: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      season: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      win: {
        type: DataTypes.INTEGER,
      },
      lose: {
        type: DataTypes.INTEGER,
      },
      defaultRating: {
        type: DataTypes.INTEGER,
      },
      additionalRating: {
        type: DataTypes.INTEGER,
      },
      discordId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {},
  );
  seasonSnapshot.associate = (/* models */) => {
    // associations can be defined here
  };
  return seasonSnapshot;
};
