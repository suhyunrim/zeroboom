// 스크림 자동 기록: 수집 게임 기반 자동 기록 행에 riotGameKey를 남겨
// 중복 기록을 방지(unique)하고 수동 기록(null)과 구분한다.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('tournament_scrims', 'riotGameKey', {
      type: Sequelize.STRING(32),
      allowNull: true, // null = 수동 기록
    });
    await queryInterface.addIndex('tournament_scrims', ['riotGameKey'], {
      name: 'tournament_scrims_game_unique',
      unique: true, // MySQL unique 인덱스는 NULL 중복 허용 → 수동 기록 다수 공존 가능
    });
  },
  down: async (queryInterface) => {
    await queryInterface.removeIndex('tournament_scrims', 'tournament_scrims_game_unique');
    await queryInterface.removeColumn('tournament_scrims', 'riotGameKey');
  },
};
