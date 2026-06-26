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
const readonlySql = require('./readonly-sql');

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
    name: 'query_recent_wins',
    description:
      '"최근 N판" 기준 승리·승률 순위를 반환한다. 그룹의 가장 최근 완료된 매치 N개를 모아 그 안에서 '
      + '플레이어별 승/패를 집계한 표를 준다(각 사람: wins, losses, games, winRate, rank). '
      + '"최근 100판 중 승리 많은 사람?", "요즘 잘나가는 사람", "최근 폼 좋은 사람" 류에 쓴다. '
      + 'query_players의 승수는 전체 누적이라 최근성 질문엔 쓰지 말 것. '
      + 'matches=집계할 최근 매치 수(기본 100, 최대 500), topN=반환 인원(기본 5). '
      + '응답의 matchesConsidered가 실제 집계된 매치 수이니(요청보다 적을 수 있음) 그 수를 근거로 답한다.',
    input_schema: {
      type: 'object',
      properties: {
        matches: { type: 'integer', description: '집계할 최근 매치 수 (기본 100, 최대 500)' },
        topN: { type: 'integer', description: '반환 인원수 (기본 5, 최대 25)' },
      },
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

// run_sql: 읽기 전용 SQL 탈출구. 전용 도구(query_*, get_*)로 답 못 하는 드문/복합 질문용.
// SELECT 전용 유저가 설정된 환경에서만 노출한다(미설정 시 도구 목록에서 제외 → LLM이 헛호출 안 함).
const RUN_SQL_TOOL = {
  name: 'run_sql',
  description:
    '이 그룹 데이터를 읽기 전용 SQL(SELECT)로 직접 조회한다. 다른 전용 도구로 답할 수 없는 '
    + '드물거나 복합적인 통계 질문에만 쓴다(예: 티어 분포, 특정 포지션 승률, 요일별 판수, 둘이 같은 팀일 때 승률 등). '
    + '규칙: SELECT 또는 WITH 로 시작하는 한 문장만. 쓰기/DDL/세미콜론 다중문/주석/사용자변수(@)는 금지. '
    + '그룹 필터는 서버가 자동 적용하니 groupId 조건을 직접 넣지 말 것. 결과는 최대 100행. '
    + '내전 레이팅(rating)은 raw 점수이니 답변엔 티어로 환산해 말한다. '
    + '조회 가능한 뷰와 컬럼 목록은 시스템 메시지에 제공된다 — 컬럼명으로 의미를 추론해 SQL을 짠다. '
    + '0/1 값 컬럼(won 등)은 AVG로 비율(승률), 최근성은 날짜 컬럼 DESC, "많은 사람"은 COUNT(*) GROUP BY로 푼다.',
  input_schema: {
    type: 'object',
    properties: { sql: { type: 'string', description: '실행할 SELECT 문 (이 그룹으로 자동 필터됨)' } },
    required: ['sql'],
  },
};

// SELECT 전용 유저가 설정돼 있으면 run_sql을 도구 목록에 추가한다.
if (readonlySql.isConfigured()) TOOLS.push(RUN_SQL_TOOL);
// ★ 프롬프트 캐싱: 마지막 도구에 캐시 분기점 → 정적 tools 전체가 캐시된다.
// tool-use 루프는 매 라운드 tools를 재전송하지만 2라운드부터 캐시 읽기(입력 0.1배)로 처리되고,
// tools는 유저 무관 완전 정적이라 요청 간(같은 모델, 5분 TTL)에도 재사용된다.
TOOLS[TOOLS.length - 1].cache_control = { type: 'ephemeral' };

// 도구명 → 브릿지 (groupId는 서버가 주입)
const DISPATCH = {
  query_players: (groupId, input) => bridges.queryPlayers(groupId, input),
  query_veterans: (groupId, input) => bridges.queryVeterans(groupId, input),
  query_recent_wins: (groupId, input) => bridges.queryRecentWins(groupId, input),
  get_player: (groupId, input) => bridges.getPlayer(groupId, input),
  get_achievement_progress: (groupId, input) => bridges.getAchievementProgress(groupId, input),
  run_sql: (groupId, input) => readonlySql.runReadonlyQuery(groupId, input),
};

function buildSystem(askerName, schemaDoc = '') {
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
    '- "최근 N판/요즘/최근에" 처럼 최근성(기간)을 묻는 승리·승률 질문은 query_recent_wins를 쓴다. query_players의 승수는 전체 누적이므로 최근 N판엔 쓰지 말 것. 최근성 질문에 "전체 누적만 가능하다"고 답하지 말 것. 단 실제 집계된 매치 수(matchesConsidered)가 요청보다 적으면 그 수를 솔직히 밝힌다(예: "최근 80판 기준").',
    schemaDoc
      ? '- 위 전용 도구들로 답할 수 없는 드문/복합 통계 질문(티어 분포, 특정 포지션 승률, 요일별 판수, 맞대결, 대회 트로피 등)은 run_sql로 직접 SELECT해서 시도한다. "그건 못 한다"고 먼저 포기하지 말 것. run_sql 결과로도 답할 수 없을 때만 솔직히 모른다고 한다. SQL 오류가 나면 메시지를 보고 한 번 더 고쳐 시도한다.'
      : null,
    schemaDoc
      ? `- run_sql로 조회 가능한 뷰(이미 이 그룹으로 자동 필터됨, 컬럼명으로 의미 추론):\n${schemaDoc}`
      : null,
    '- puuid/디스코드ID 같은 내부 식별자는 절대 노출하지 않는다.',
    '- 도구 결과로 답할 수 없으면 솔직히 "그 정보는 아직 답하기 어렵다"고 말한다. 환각 금지.',
    '- 답은 핵심부터. 필요하면 짧은 근거(수치)를 덧붙인다.',
  ].filter(Boolean).join('\n');
}

function isConfigured() {
  return !!(config.ai && config.ai.apiKey);
}

// Anthropic 크레딧 소진(잔액 부족) 에러 판별 — 일반 오류와 구분해 유저에게 명시적으로 안내하기 위함.
// 크레딧 부족은 보통 400 "Your credit balance is too low..." 또는 type=billing_error 로 온다.
function isCreditError(e) {
  if (!e) return false;
  const type = (e.error && e.error.type) || e.type;
  if (type === 'billing_error') return true;
  const msg = `${e.message || ''} ${(e.error && e.error.message) || ''}`.toLowerCase();
  return msg.includes('credit balance') || (msg.includes('credit') && msg.includes('low'));
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

  // run_sql 사용 가능 시, 현재 DB의 ai_* 뷰 스키마를 동적으로 읽어 프롬프트에 주입(자동 발견).
  const schemaDoc = await readonlySql.getSchemaDoc();
  const system = buildSystem(askerName, schemaDoc);
  const messages = [...sanitizeHistory(history), { role: 'user', content: question.trim() }];
  const toolCalls = [];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let resp;
    try {
      // eslint-disable-next-line no-await-in-loop
      resp = await client().messages.create({
        model: config.ai.model,
        max_tokens: MAX_TOKENS,
        // ★ system도 캐시 분기점. 멀티라운드 루프 안에서 동일 prefix(tools+system)가 반복되므로
        //   2라운드부터 입력이 캐시 읽기로 처리된다. (system은 askerName 포함이라 유저 단위 캐시)
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages,
      });
    } catch (e) {
      // ★ 크레딧 소진은 유저에게 명시적으로 안내(일반 "오류 발생"으로 묻히지 않게). 그 외 에러는 라우트가 처리.
      if (isCreditError(e)) {
        logger.error(`[ai.agent] Anthropic 크레딧 소진: ${e.message}`);
        return { answer: '⚠️ 지금 AI 크레딧이 다 떨어져서 답변을 드릴 수 없어요. 관리자가 크레딧을 충전하면 다시 이용할 수 있어요 🙏', toolCalls };
      }
      throw e;
    }

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

module.exports = { ask, isConfigured, isCreditError, TOOLS, sanitizeHistory };
