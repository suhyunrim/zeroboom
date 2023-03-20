module.exports = (sequelize, DataTypes) => {
  const riot_match = sequelize.define(
    'riot_match',
    {
      matchId: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },
      participants: {
        type: DataTypes.STRING(1024),
        get: function() {
            return JSON.parse(this.getDataValue('participants'));
        }, 
        set: function(val) {
            return this.setDataValue('participants', JSON.stringify(val));
        },
        allowNull: false,
      },
      gameCreation: {
        type: DataTypes.DATE,
      },
    },
    {},
  );
  riot_match.associate = (/* models */) => {
    // associations can be defined here
  };
  return riot_match;
};
