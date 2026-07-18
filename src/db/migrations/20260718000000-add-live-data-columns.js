// elise 실시간 수집(Live Client Data API + 챔프 셀렉트) 원본 보관용 컬럼.
// 전부 nullable — null = "실시간 수집 없음"(대부분의 판). 게임 도중 elise가 켜져 있던 판에만 채워진다.
// 매치 히스토리에 없는 정보(사건 시각/주체·대상, 용 속성, 스틸 여부, 밴 주체·픽 순서)를 담으며,
// 소급 수집이 불가능하므로 구조화 전에 원본을 그대로 쌓아둔다.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const col = { type: Sequelize.TEXT('long'), allowNull: true };
    await queryInterface.addColumn('lcu_game_raws', 'liveEventsJson', col);
    await queryInterface.addColumn('lcu_game_raws', 'liveTimelineJson', col);
    await queryInterface.addColumn('lcu_game_raws', 'champSelectJson', col);
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('lcu_game_raws', 'liveEventsJson');
    await queryInterface.removeColumn('lcu_game_raws', 'liveTimelineJson');
    await queryInterface.removeColumn('lcu_game_raws', 'champSelectJson');
  },
};
