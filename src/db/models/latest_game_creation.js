module.exports = (sequelize, DataTypes) => {
  const latest_game_creation = sequelize.define(
    'latest_game_creation',
    {
      accountId: {
        type: DataTypes.STRING,
        primaryKey: true,
      },
      gameCreation: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {},
  );
  latest_game_creation.associate = (/* models */) => {
    // associations can be defined here
  };
  return latest_game_creation;
};
