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
      heldAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      allowSingleTeam: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // 승부예측 방식: 'bracket'(전체 미리 예측) | 'rolling'(확정된 경기만 순차 예측)
      predictionMode: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'bracket',
      },
      type: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'normal',
      },
      auctionConfig: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      currentAuctionPuuid: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      currentAuctionDeadline: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // 이번 패스에 이미 매물로 올라온 후보(유찰 포함) puuid 목록.
      // 유찰자를 패스가 끝날 때까지 다시 안 뽑고, 패스가 끝나면 비워 새 패스를 시작한다.
      auctionOfferedPuuids: {
        type: DataTypes.JSON,
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
