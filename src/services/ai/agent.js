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
const HISTORY_MAX_TURNS = 12; // 멀티턴 컨텍스트로 유지할 직전 대화 수
const HISTORY_MAX_CHARS = 2000; // 각 메시지 길이 상한

// 클라이언트가 보낸 이전 대화 기록을 Anthropic messages 형식으로 안전하게 정규화.
// role은 user/assistant만, content는 문자열, 최근 N턴만, 첫 메시지는 user여야 함.
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  let turns = history
    .map((h) => ({
      role: h && (h.role === 'assistant' || h.role === 'ai') ? 'assistant' : 'user',
      content: h && typeof h.content === 'string' ? h.content.trim().slice(0, HISTORY_MAX_CHARS) : '',
    }))
    .filter((h) => h.content);
  turns = turns.slice(-HISTORY_MAX_TURNS);
  while (turns.length && turns[0].role === 'assistant') turns.shift();
  return turns;
}

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
    name: 'query_veterans',
    description:
      '"고인물/올드비/짬" 종합 순위를 반환한다. 그룹 전체에 대해 판수·가입기간을 코드가 합성해 '
      + '종합 순위로 정렬한 표를 준다(각 사람: games, gamesRank, tenureDays, tenureRank, '
      + 'score(0~100 종합점수, 클수록 고인물), rank(종합순위)). score는 두 지표의 정규화 평균이라 '
      + '가입일 하루 차이는 거의 영향이 없다. "고인물 누구?" 류 질문은 반드시 이 도구 하나로 답한다. '
      + 'query_players를 두 번 호출해 직접 합치지 말 것.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: '반환 인원수 (기본 10, 최대 25)' } },
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
    // ★ 프롬프트 캐싱: 마지막 도구에 캐시 분기점을 두면 정적인 tools 정의 전체가 캐시된다.
    // tool-use 루프는 매 라운드 tools를 재전송하는데, 2번째 라운드부터 캐시 읽기(입력 0.1배)로 처리.
    // tools는 유저 무관 완전 정적이라 요청 간(같은 모델, 5분 TTL)에도 재사용된다.
    cache_control: { type: 'ephemeral' },
  },
];

// 도구명 → 브릿지 (groupId는 서버가 주입)
const DISPATCH = {
  query_players: (groupId, input) => bridges.queryPlayers(groupId, input),
  query_veterans: (groupId, input) => bridges.queryVeterans(groupId, input),
  get_player: (groupId, input) => bridges.getPlayer(groupId, input),
  get_achievement_progress: (groupId, input) => bridges.getAchievementProgress(groupId, input),
};

function buildSystem(askerName) {
  return [
    '너는 LoL 내전 커뮤니티 봇 "ZeroBoom"의 데이터 도우미다. 한국어로, 친근하고 간결하게 답한다.',
    '규칙:',
    '- 통계/사실은 반드시 제공된 도구로 조회해서 답한다. 수치를 추측하거나 지어내지 않는다.',
    '- 순위·수치는 도구 결과에 "있는 값만" 말한다. 결과에 없는 사람의 순위를 "순위권 밖" 등으로 단정하지 않는다. 특정 인물이 궁금하면 limit를 늘리거나 get_player로 직접 확인한 뒤 답한다.',
    '- 사람 이름은 도구 결과의 값을 글자 그대로 쓴다. 변형/축약하거나 특수문자(#태그 등)를 임의로 바꾸지 않는다.',
    '- 내전 레이팅/실력은 항상 티어로 말한다(ratingTier, 예: "골드 4"). raw 레이팅 점수(숫자)는 노출하지 않는다. ratingTier(내전 티어)와 rankTier(솔로랭크 티어)는 다른 값이니 섞지 않는다.',
    '- 현재 그룹은 이미 고정돼 있다. "어느 그룹이냐" 되묻지 말고 바로 이 그룹 기준으로 답한다.',
    askerName ? `- 질문자는 "${askerName}" 이다. "나/내/제"는 이 사람을 가리킨다.` : '- 질문자가 "나/내"라고 하면 누구인지 이름을 물어본다.',
    '- "고인물/올드비/짬" 질문은 query_veterans 한 번으로 답한다. 판수·가입기간 종합 순위가 이미 계산돼 나오니 query_players를 두 번 호출해 직접 합치지 말 것.',
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
 * @param {{ groupId:number, question:string, askerName?:string, history?:Array }} params
 *   history: 이전 대화 [{ role:'user'|'assistant'|'ai', content:string }, ...] (멀티턴 컨텍스트)
 * @returns {Promise<{ answer:string, toolCalls:Array<{name:string,input:object}> }>}
 */
async function ask({ groupId, question, askerName = null, history = [] }) {
  if (!groupId) throw new Error('groupId가 필요합니다.');
  if (!question || !question.trim()) throw new Error('question이 필요합니다.');
  if (!isConfigured()) {
    return { answer: 'AI 채팅 기능이 아직 설정되지 않았어요. (서버에 ANTHROPIC_API_KEY 설정 필요)', toolCalls: [] };
  }

  const system = buildSystem(askerName);
  const messages = [...sanitizeHistory(history), { role: 'user', content: question.trim() }];
  const toolCalls = [];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    const resp = await client().messages.create({
      model: config.ai.model,
      max_tokens: MAX_TOKENS,
      // ★ system도 캐시 분기점. 멀티라운드 루프 안에서 동일 prefix(tools+system)가 반복되므로
      //   2라운드부터 입력이 캐시 읽기로 처리된다. (system은 askerName 포함이라 유저 단위 캐시)
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
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

module.exports = { ask, isConfigured, TOOLS, sanitizeHistory };
