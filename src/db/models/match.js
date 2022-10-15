module.exports = (sequelize, DataTypes) => {
  const match = sequelize.define(
    'match',
    {
      gameId: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      groupId: {
        type: DataTypes.INTEGER,
      },
      team1: {
        type: DataTypes.STRING,
        get: function() {
            return JSON.parse(this.getDataValue('team1'));
        }, 
        set: function(val) {
            return this.setDataValue('team1', JSON.stringify(val));
        },
        allowNull: false,
      },
      team2: {
        type: DataTypes.STRING,
        get: function() {
            return JSON.parse(this.getDataValue('team2'));
        }, 
        set: function(val) {
            return this.setDataValue('team2', JSON.stringify(val));
        },
        allowNull: false,
      },
      winTeam: {
        type: DataTypes.INTEGER,
      },
      gameCreation: {
        type: DataTypes.DATE,
      },
    },
    {},
  );
  match.associate = (/* models */) => {
    // associations can be defined here
  };
  return match;
};
