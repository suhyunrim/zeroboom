// 스크림(대회 팀 연습) 분리: 수집 게임의 한 팀 5인 중 4명 이상이 진행 중 대회 팀과
// 일치하면 스크림으로 태깅해 내전 통계(모스트/티어리스트)에서 제외한다.
// null = 미판정(재처리 전 과거분), false = 정규 내전, true = 스크림.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('lcu_game_raws', 'isScrim', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    });
    await queryInterface.addColumn('lcu_game_raws', 'scrimTournamentId', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('match_player_stats', 'isScrim', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('match_player_stats', 'isScrim');
    await queryInterface.removeColumn('lcu_game_raws', 'scrimTournamentId');
    await queryInterface.removeColumn('lcu_game_raws', 'isScrim');
  },
};
