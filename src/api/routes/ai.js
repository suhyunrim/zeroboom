const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const { optionalAuth } = require('../middlewares/auth');
const models = require('../../db/models');
const auditLog = require('../../controller/audit-log');
const agent = require('../../services/ai/agent');

const route = Router();

const QUESTION_MAX_LENGTH = 500;

module.exports = (app) => {
  app.use('/ai', route);

  /**
   * POST /api/ai/ask
   * body/query: { groupId, question }
   * 세션이 있으면 질문자 이름을 해석해 "나/내" 컨텍스트로 넘긴다.
   */
  route.post('/ask', optionalAuth, async (req, res) => {
    const groupId = Number(req.body.groupId || req.query.groupId);
    const question = (req.body.question || '').toString();

    if (!groupId) return res.status(400).json({ result: 'groupId가 필요합니다.' });
    if (!question.trim()) return res.status(400).json({ result: 'question이 필요합니다.' });
    if (question.length > QUESTION_MAX_LENGTH) {
      return res.status(400).json({ result: `질문은 ${QUESTION_MAX_LENGTH}자 이하로 해주세요.` });
    }

    try {
      // 질문자 이름 해석 (세션 puuid → 소환사명). 없으면 익명.
      let askerName = null;
      const askerPuuid = req.user && req.user.puuid;
      if (askerPuuid) {
        const s = await models.summoner.findOne({ where: { puuid: askerPuuid }, attributes: ['name'], raw: true });
        askerName = s ? s.name : null;
      }

      // history: 클라이언트가 보낸 이전 대화(멀티턴 컨텍스트). 에이전트가 정규화/상한 처리.
      const { answer, toolCalls } = await agent.ask({ groupId, question, askerName, history: req.body.history });

      auditLog.log({
        groupId,
        actorDiscordId: (req.user && req.user.discordId) || null,
        actorName: askerName,
        action: 'ai.ask',
        details: { question, toolCalls: toolCalls.map((t) => t.name) },
        source: 'web',
      });

      return res.status(200).json({ result: { answer, toolCalls } });
    } catch (e) {
      logger.error(`[ai.ask] ${e.stack || e.message}`);
      return res.status(500).json({ result: '답변 생성 중 오류가 발생했습니다.' });
    }
  });
};
