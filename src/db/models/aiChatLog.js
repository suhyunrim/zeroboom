module.exports = (sequelize, DataTypes) => {
  // AI 채팅 Q&A 익명 기록 — 답변 품질 검수용.
  // ★ 작성자(puuid/discordId/이름) 필드를 의도적으로 두지 않는다(익명화).
  //   "누가 AI를 썼는지"의 책임 추적은 audit_log(action='ai.ask', 질문 내용 제외)가 담당.
  const aiChatLog = sequelize.define(
    'ai_chat_log',
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
      question: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      answer: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      model: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      toolCalls: {
        // 어떤 도구를 어떤 입력으로 호출했는지(run_sql의 SQL 포함) — 답변 추적용
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {},
  );
  aiChatLog.associate = (/* models */) => {};
  return aiChatLog;
};
