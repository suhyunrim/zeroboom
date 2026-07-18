// elise 수집기 진단용 테이블.
// 배경: 수집기가 멈춰도 서버엔 "요청이 안 온다"는 부재만 남아, 사용자가 껐는지·크래시인지·롤을 안 켰는지
// 구분할 수 없었다(2026-07-18 강빈공듀 건: 게임 3판이 통째로 유실됐는데 원인 추정만 가능).
//
// collector_installs = 설치 1개당 1행(최신 상태), collector_telemetry_events = 상태가 바뀐 순간의 이력.
// 하트비트는 이벤트로 남기지 않는다(20분 주기 × 설치 수 = 연 수십만 행인데 최신 시각 외엔 가치가 없음).
// 신원: 게임 업로드가 없으면 puuid를 알 수 없으므로 클라가 생성한 installId가 기본 키 역할을 하고,
// LCU를 한 번이라도 본 뒤에는 riotId/puuid가 채워져 사람과 연결된다.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('collector_installs', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      installId: { type: Sequelize.STRING(64), allowNull: false },
      riotId: { type: Sequelize.STRING(64), allowNull: true },
      puuid: { type: Sequelize.STRING(128), allowNull: true },
      version: { type: Sequelize.STRING(32), allowNull: true },
      platform: { type: Sequelize.STRING(32), allowNull: true },
      appStartedAt: { type: Sequelize.DATE, allowNull: true },
      lastEventAt: { type: Sequelize.DATE, allowNull: true },
      lastHeartbeatAt: { type: Sequelize.DATE, allowNull: true },
      lcuConnected: { type: Sequelize.BOOLEAN, allowNull: true }, // null = 아직 모름
      lastScanAt: { type: Sequelize.DATE, allowNull: true },
      lastUploadAt: { type: Sequelize.DATE, allowNull: true },
      lastQuitAt: { type: Sequelize.DATE, allowNull: true },
      lastQuitReason: { type: Sequelize.STRING(32), allowNull: true },
      lastCrashAt: { type: Sequelize.DATE, allowNull: true },
      lastCrashMessage: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('collector_installs', ['installId'], {
      unique: true,
      name: 'collector_installs_install_id',
    });

    await queryInterface.createTable('collector_telemetry_events', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      installId: { type: Sequelize.STRING(64), allowNull: false },
      type: { type: Sequelize.STRING(24), allowNull: false }, // start | quit | crash | lcu
      reason: { type: Sequelize.STRING(32), allowNull: true }, // quit: user_quit | update_restart | unknown
      version: { type: Sequelize.STRING(32), allowNull: true },
      riotId: { type: Sequelize.STRING(64), allowNull: true },
      message: { type: Sequelize.TEXT, allowNull: true }, // crash 스택 등
      occurredAt: { type: Sequelize.DATE, allowNull: false }, // 클라이언트 시각 (createdAt=수신 시각과 다를 수 있음)
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('collector_telemetry_events', ['installId', 'occurredAt'], {
      name: 'collector_telemetry_events_install_occurred',
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('collector_telemetry_events');
    await queryInterface.dropTable('collector_installs');
  },
};
