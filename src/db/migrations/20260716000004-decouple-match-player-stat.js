// 내전 통계 수집을 봇 match 매핑과 분리:
// - match_player_stats.matchId 를 nullable로 (수동 커스텀 로비는 봇 match가 없어도 통계 생성)
// - lcu_game_raws.statsProcessedAt 추가 (통계 생성 완료 여부. 매핑 여부(mappedMatchId)와 별개)
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('match_player_stats', 'matchId', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('lcu_game_raws', 'statsProcessedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('lcu_game_raws', 'statsProcessedAt');
    await queryInterface.changeColumn('match_player_stats', 'matchId', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });
  },
};
