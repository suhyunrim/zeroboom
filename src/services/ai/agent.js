/**
 * AI 채팅 에이전트 — Claude tool-use 루프.
 *
 * - 프로바이더 의존(Anthropic SDK)은 이 파일에만 가둔다. OpenAI 등으로 교체 시 여기만 수정.
 * - groupId는 서버가 주입하며, 도구 호출 시 LLM 입력이 아니라 이 값으로 그룹을 강제한다(크로스그룹 차단).
 * - ANTHROPIC_API_KEY 미설정 시 앱은 정상 동작하고 이 함수만 안내 메시지를 반환한다.
 */
const config = require('../../config');
const { logger } = require('../../loaders/logger');
const bridges = require('./bridges');

const MAX_ROUNDS = config.ai.maxRounds || 5;
const MAX_TOKENS = 1024;

// LLM에 노출하는 도구 정의 (브릿지와 1:1). groupId는 여기에 없음 — 서버가 주입.
const TOOLS = [
  {
    name: 'query_players',
    description:
      '그룹 내 플레이어를 지표 기준으로 정렬해 상위 N명을 반환한다. '
      + '"고인물/판수왕"은 metric=games, "승률왕"은 winRate, "1황/레이팅순위"는 rating, '
      + '"가장 오래된 멤버/짬"은 tenureDays 를 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['games', 'winRate', 'rating', 'tenureDays'], description: '정렬 지표' },
        order: { type: 'string', enum: ['desc', 'asc'], description: '내림차순(기본)/오름차순' },
        limit: { type: 'integer', description: '반환 인원수 (기본 10, 최대 25)' },
      },
      required: ['metric'],
    },
  },
  {
    name: 'get_player',
    description:
      '한 플레이어의 상세 정보(티어, 메인/서브 포지션, 전적, 레이팅, 최근 승률, 최다 연승/연패, '
      + '내전 포지션별 승률, 모스트 챔피언, 명예 포인트)를 반환한다.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: '플레이어 이름(부분 일치 가능)' } },
      required: ['name'],
    },
  },
  {
    name: 'get_achievement_progress',
    description:
      '한 플레이어의 업적 진행도를 반환한다. 획득한 업적 수, 그리고 "달성에 가장 가까운 미획득 업적"을 '
      + '현재값/목표/남은수와 함께 준다. "업적 더 따려면 뭘 해야 해?" 류 질문에 사용.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: '플레이어 이름(부분 일치 가능)' } },
      required: ['name'],
    },
  },
];

// 도구명 → 브릿지 (groupId는 서버가 주입)
const DISPATCH = {
  query_players: (groupId, input) => bridges.queryPlayers(groupId, input),
  get_player: (groupId, input) => bridges.getPlayer(groupId, input),
  get_achievement_progress: (groupId, input) => bridges.getAchievementProgress(groupId, input),
};

function buildSystem(askerName) {
  return [
    '너는 LoL 내전 커뮤니티 봇 "ZeroBoom"의 데이터 도우미다. 한국어로, 친근하고 간결하게 답한다.',
    '규칙:',
    '- 통계/사실은 반드시 제공된 도구로 조회해서 답한다. 수치를 추측하거나 지어내지 않는다.',
    '- 현재 그룹은 이미 고정돼 있다. "어느 그룹이냐" 되묻지 말고 바로 이 그룹 기준으로 답한다.',
    askerName ? `- 질문자는 "${askerName}" 이다. "나/내/제"는 이 사람을 가리킨다.` : '- 질문자가 "나/내"라고 하면 누구인지 이름을 물어본다.',
    '- "고인물"은 총 판수+가입기간으로 종합 판단한다. 한 지표만 보지 말고 필요하면 도구를 여러 번 쓴다.',
    '- puuid/디스코드ID 같은 내부 식별자는 절대 노출하지 않는다.',
    '- 도구 결과로 답할 수 없으면 솔직히 "그 정보는 아직 답하기 어렵다"고 말한다. 환각 금지.',
    '- 답은 핵심부터. 필요하면 짧은 근거(수치)를 덧붙인다.',
  ].join('\n');
}

function isConfigured() {
  return !!(config.ai && config.ai.apiKey);
}

let _client = null;
function client() {
  if (_client) return _client;
  const Anthropic = require('@anthropic-ai/sdk');
  _client = new Anthropic({ apiKey: config.ai.apiKey });
  return _client;
}

/**
 * 질문에 답한다.
 * @param {{ groupId:number, question:string, askerName?:string }} params
 * @returns {Promise<{ answer:string, toolCalls:Array<{name:string,input:object}> }>}
 */
async function ask({ groupId, question, askerName = null }) {
  if (!groupId) throw new Error('groupId가 필요합니다.');
  if (!question || !question.trim()) throw new Error('question이 필요합니다.');
  if (!isConfigured()) {
    return { answer: 'AI 채팅 기능이 아직 설정되지 않았어요. (서버에 ANTHROPIC_API_KEY 설정 필요)', toolCalls: [] };
  }

  const system = buildSystem(askerName);
  const messages = [{ role: 'user', content: question.trim() }];
  const toolCalls = [];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    const resp = await client().messages.create({
      model: config.ai.model,
      max_tokens: MAX_TOKENS,
      system,
      tools: TOOLS,
      messages,
    });

    if (resp.stop_reason !== 'tool_use') {
      const answer = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { answer: answer || '음… 답을 만들지 못했어요. 다시 물어봐 주세요.', toolCalls };
    }

    messages.push({ role: 'assistant', content: resp.content });
    const toolResults = [];
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue;
      toolCalls.push({ name: block.name, input: block.input });
      const handler = DISPATCH[block.name];
      let result;
      let isError = false;
      try {
        result = handler
          ? await handler(groupId, block.input || {}) // ★ groupId는 서버 주입
          : { error: `unknown tool: ${block.name}` };
        if (!handler) isError = true;
      } catch (e) {
        logger.error(`[ai.agent] tool ${block.name} 실패: ${e.message}`);
        result = { error: '도구 실행 중 오류가 발생했어요.' };
        isError = true;
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
        is_error: isError,
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return { answer: '질문이 복잡해서 정리하지 못했어요. 조금 더 구체적으로 물어봐 주세요.', toolCalls };
}

module.exports = { ask, isConfigured, TOOLS };
