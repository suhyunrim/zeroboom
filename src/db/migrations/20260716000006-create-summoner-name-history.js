// 닉네임 변경 이력: 닉변 감지 시 "옛 닉네임 → puuid" 매핑을 보존한다.
// LCU 수집 게임 원본엔 게임 당시 닉네임이 고정 기록되는데, DB가 새 닉으로 갱신된 후
// 업로드되면 이름 브릿지가 영구 실패하므로 이 이력이 유일한 식별 경로다.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('summoner_name_histories', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      puuid: { type: Sequelize.STRING(128), allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false }, // 옛 닉네임 (gameName#tagLine)
      changedAt: { type: Sequelize.DATE, allowNull: false }, // 닉변 감지 시각 (이 시각까지 이 이름 소유)
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('summoner_name_histories', ['name'], {
      name: 'summoner_name_histories_name',
    });
    await queryInterface.addIndex('summoner_name_histories', ['puuid'], {
      name: 'summoner_name_histories_puuid',
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('summoner_name_histories');
  },
};
