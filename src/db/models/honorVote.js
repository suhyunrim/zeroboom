module.exports = (sequelize, DataTypes) => {
  const honorVote = sequelize.define(
    'honor_vote',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      gameId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      groupId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      voterPuuid: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      targetPuuid: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      teamNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {},
  );
  honorVote.associate = (/* models */) => {
    // associations can be defined here
  };
  return honorVote;
};
