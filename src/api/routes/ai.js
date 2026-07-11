const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const { verifyToken } = require('../middlewares/auth');
const aiRateLimit = require('../middlewares/ai-rate-limit');
const models = require('../../db/models');
const auditLog = require('../../controller/audit-log');
const agent = require('../../services/ai/agent');
const config = require('../../config');

const route = Router();

const QUESTION_MAX_LENGTH = 500;

module.exports = (app) => {
  app.use('/ai', route);

  /**
   * GET /api/ai/quota
   * 로그인 필수. 카운트를 소비하지 않고 오늘 사용/잔여/총 한도를 반환한다(페이지 진입 시 표시용).
   * limit=0 이면 무제한(remaining은 직렬화 시 null).
   */
  route.get('/quota', verifyToken, (req, res) => {
    const q = aiRateLimit.peek(req.user.puuid);
    return res.status(200).json({ result: { used: q.used, remaining: q.remaining, limit: q.limit } });
  });

  /**
   * POST /api/ai/ask
   * body/query: { groupId, question, history }
   * 로그인 필수(verifyToken). 질문자 puuid로 "나/내" 컨텍스트 + 일일 호출 제한을 건다.
   */
  route.post('/ask', verifyToken, async (req, res) => {
    const groupId = Number(req.body.groupId || req.query.groupId);
    const question = (req.body.question || '').toString();

    if (!groupId) return res.status(400).json({ result: 'groupId가 필요합니다.' });
    if (!question.trim()) return res.status(400).json({ result: 'question이 필요합니다.' });
    if (question.length > QUESTION_MAX_LENGTH) {
      return res.status(400).json({ result: `질문은 ${QUESTION_MAX_LENGTH}자 이하로 해주세요.` });
    }

    // 인당 일일 한도. 초과 시 에러가 아니라 안내 답변(200)으로 돌려 채팅에 그대로 표시되게 한다.
    const askerPuuid = req.user.puuid;
    const gate = aiRateLimit.consume(askerPuuid);
    if (!gate.ok) {
      return res.status(200).json({
        result: {
          answer: `오늘 AI 질문 한도(${gate.limit}회)를 모두 사용했어요. 내일 다시 물어봐 주세요 🙏`,
          toolCalls: [],
          rateLimited: true,
          used: gate.used,
          remaining: gate.remaining,
          limit: gate.limit,
        },
      });
    }

    try {
      // 질문자 이름 해석 (puuid → 소환사명). 없으면 이름만 미상으로 진행.
      let askerName = null;
      if (askerPuuid) {
        const s = await models.summoner.findOne({ where: { puuid: askerPuuid }, attributes: ['name'], raw: true });
        askerName = s ? s.name : null;
      }

      // history: 클라이언트가 보낸 이전 대화(멀티턴 컨텍스트). 에이전트가 정규화/상한 처리.
      const { answer, toolCalls, usage } = await agent.ask({ groupId, question, askerName, history: req.body.history });

      // ★ 익명 Q&A 기록(답변 품질 검수용) — 작성자 식별자 없이 질문·답변·도구호출·토큰 사용량만 저장.
      models.ai_chat_log.create({
        groupId,
        question,
        answer,
        model: config.ai.model,
        toolCalls, // name+input 전체(run_sql의 SQL 포함) — 답변 추적용
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        thinkingTokens: usage?.thinkingTokens ?? null,
      }).catch((e) => logger.error(`[ai.chat_log] 기록 실패: ${e.message}`));

      // 감사 로그: "누가 AI를 썼는지"(책임추적)만 남기고 질문 내용은 제외 — 방명록 비밀글처럼 익명화.
      auditLog.log({
        groupId,
        actorDiscordId: (req.user && req.user.discordId) || null,
        actorName: askerName,
        action: 'ai.ask',
        details: { toolCalls: toolCalls.map((t) => t.name) },
        source: 'web',
      });

      return res.status(200).json({
        result: { answer, toolCalls, used: gate.used, remaining: gate.remaining, limit: gate.limit },
      });
    } catch (e) {
      logger.error(`[ai.ask] ${e.stack || e.message}`);
      return res.status(500).json({ result: '답변 생성 중 오류가 발생했습니다.' });
    }
  });
};
