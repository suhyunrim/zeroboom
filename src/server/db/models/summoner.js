'use strict';
module.exports = (sequelize, DataTypes) => {
  const summoner = sequelize.define('summoner', {
    riotId: {
      type: DataTypes.STRING
    },
    accountId: {
      type: DataTypes.STRING
    },
    puuid: {
      type: DataTypes.STRING
    },
    name: {
      type: DataTypes.STRING
    },
    profileIconId: {
      type: DataTypes.INTEGER
    },
    revisionDate: {
      type: DataTypes.DATE
    },
    summonerLevel: {
      type: DataTypes.INTEGER
    },
  }, {});
  summoner.associate = function(models) {
    // associations can be defined here
  };
  return summoner;
};
