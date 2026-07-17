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
        type: DataTypes.STRING(1024),
        // 스태틱 match.update()는 값 없는 더미 인스턴스에서도 getter를 호출하므로
        // undefined 방어가 없으면 JSON.parse가 던져 업데이트 자체가 실패한다
        get: function() {
            const raw = this.getDataValue('team1');
            return raw == null ? raw : JSON.parse(raw);
        },
        set: function(val) {
            return this.setDataValue('team1', JSON.stringify(val));
        },
        allowNull: false,
      },
      team2: {
        type: DataTypes.STRING(1024),
        get: function() {
            const raw = this.getDataValue('team2');
            return raw == null ? raw : JSON.parse(raw);
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
      seasonId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      discordChannelId: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      discordMessageId: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
    },
    {},
  );
  match.associate = (/* models */) => {
    // associations can be defined here
  };
  return match;
};
