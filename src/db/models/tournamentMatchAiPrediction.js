module.exports = (sequelize, DataTypes) => {
  // 대회 매치별 AI 승부예측 — 유저 예측과 같은 마감선(rolling=매치 시작, bracket=대회 첫 매치 시작)으로
  // 이벤트(대진 확정/스크림/팀 수정) 때마다 서버가 재계산해 upsert하고, 마감 후엔 동결된다.
  // 유저 예측 테이블(tournament_match_predictions)과 분리해 리더보드/퍼펙트예측 집계 오염을 막는다.
  const tournamentMatchAiPrediction = sequelize.define(
    'tournament_match_ai_prediction',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      tournamentId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      matchId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
      },
      predictedTeamId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      team1WinProb: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      team2WinProb: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      // 팝업 표시용 근거 스냅샷: { team1, team2, headToHeadScrim } (팀별 티어/포지션적합도/시너지/스크림/멤버)
      factors: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      computedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      indexes: [{ fields: ['tournamentId'] }],
    },
  );
  tournamentMatchAiPrediction.associate = (/* models */) => {};
  return tournamentMatchAiPrediction;
};
