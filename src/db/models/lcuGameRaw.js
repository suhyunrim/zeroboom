// null을 그대로 보존하는 JSON 컬럼 (값이 없으면 저장도 조회도 null)
const jsonColumn = (type, field) => ({
  type,
  allowNull: true,
  get() {
    const raw = this.getDataValue(field);
    return raw ? JSON.parse(raw) : null;
  },
  set(val) {
    this.setDataValue(field, val == null ? null : JSON.stringify(val));
  },
});

module.exports = (sequelize, DataTypes) => {
  const lcuGameRaw = sequelize.define(
    'lcu_game_raw',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      riotGameKey: { type: DataTypes.STRING(32), allowNull: false },
      groupId: { type: DataTypes.INTEGER, allowNull: false },
      uploaderPuuid: { type: DataTypes.STRING(128), allowNull: false },
      gameCreation: { type: DataTypes.DATE, allowNull: false },
      gameDuration: { type: DataTypes.INTEGER, allowNull: false },
      gameVersion: { type: DataTypes.STRING(32) },
      mapId: { type: DataTypes.INTEGER },
      queueId: { type: DataTypes.INTEGER },
      bansJson: {
        type: DataTypes.TEXT,
        get() {
          const raw = this.getDataValue('bansJson');
          return raw ? JSON.parse(raw) : [];
        },
        set(val) {
          this.setDataValue('bansJson', JSON.stringify(val || []));
        },
      },
      rawJson: {
        type: DataTypes.TEXT('long'),
        allowNull: false,
        get() {
          const raw = this.getDataValue('rawJson');
          return raw ? JSON.parse(raw) : null;
        },
        set(val) {
          this.setDataValue('rawJson', JSON.stringify(val));
        },
      },
      // elise 실시간 수집 원본 (없는 판이 대부분 → null이 기본. bansJson과 달리 빈 배열로 대체하지 않는다:
      // "수집 안 된 판"과 "수집됐는데 비어 있는 판"을 구분해야 한다)
      liveEventsJson: jsonColumn(DataTypes.TEXT('long'), 'liveEventsJson'),
      liveTimelineJson: jsonColumn(DataTypes.TEXT('long'), 'liveTimelineJson'),
      champSelectJson: jsonColumn(DataTypes.TEXT('long'), 'champSelectJson'),
      mappedMatchId: { type: DataTypes.INTEGER, allowNull: true },
      statsProcessedAt: { type: DataTypes.DATE, allowNull: true }, // match_player_stats 생성 완료 시각 (매핑 여부와 별개)
      isScrim: { type: DataTypes.BOOLEAN, allowNull: true }, // null=미판정, true=대회 팀 스크림
      scrimTournamentId: { type: DataTypes.INTEGER, allowNull: true },
    },
    {},
  );
  lcuGameRaw.associate = (/* models */) => {};
  return lcuGameRaw;
};
