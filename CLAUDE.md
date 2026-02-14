# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.


# CLAUDE.md - ZeroBoom Bot 프로젝트 가이드

이 문서는 Claude AI가 ZeroBoom Bot 프로젝트를 이해하고 작업하는 데 필요한 정보를 제공합니다.

## Claude와의 의사소통

**중요: 모든 응답은 한글로 작성해야 합니다.**

- 코드 주석, 커밋 메시지, 문서 작성 시에도 한글을 사용합니다.
- 기술 용어는 영문으로 표기 (예: ActionRow)

## 프로젝트 개요

**ZeroBoom Bot**은 리그 오브 레전드(LoL) 커뮤니티를 위한 Discord 봇 서비스입니다. 주요 기능으로 자동 팀 매칭, ELO 레이팅 시스템, Riot API 연동을 제공합니다.

- **버전**: 0.4.0
- **기술 스택**: Node.js, Express.js, Discord.js v14, MySQL (Sequelize), Riot API

## 빠른 명령어

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 프로덕션 실행
npm start

# 테스트 실행
npm test

# 린트 검사
npm run lint
```

## 프로젝트 구조

```
src/
├── app.js                    # 애플리케이션 진입점
├── api/                      # Express REST API
│   └── routes/               # API 라우트 핸들러
├── commands/                 # Discord 슬래시 명령어
├── config/                   # 환경설정
├── controller/               # 비즈니스 로직
├── db/
│   ├── models/               # Sequelize 모델
│   └── migrations/           # DB 마이그레이션
├── loaders/                  # 앱 초기화 로더
├── match-maker/              # 매칭 알고리즘
├── rating-system/            # ELO 레이팅 시스템
├── services/                 # 외부 API 서비스
└── views/                    # EJS 템플릿
```

## 핵심 컴포넌트

### 1. Discord 봇 명령어 (`src/commands/`)

| 명령어 | 파일 | 설명 |
|--------|------|------|
| 매칭생성 | `match-make.js` | 10명 플레이어 자동 팀 매칭 |
| 방등록 | `register-dicord.js` | Discord 서버에 그룹 등록 |
| 인원뽑기 | `pick-users.js` | 음성채널에서 랜덤 10명 선택 |
| 버전 | `version.js` | 봇 버전 정보 |

### 2. 매칭 알고리즘 (`src/match-maker/match-maker.js`)

- 재귀 + 백트래킹 알고리즘으로 최적 팀 분배
- 레이팅 차이를 최소화하는 상위 3개 매칭안 반환
- 10명을 5:5로 나누어 균형잡힌 게임 생성

### 3. ELO 레이팅 시스템 (`src/rating-system/rating-system.js`)

- K-factor: 16
- arpad 라이브러리 사용
- 승패에 따라 자동으로 레이팅 조정

### 4. Riot API 연동 (`src/services/riot-api.js`)

- V4 API: 소환사 정보, 랭크 데이터
- V5 API: 매치 데이터
- 소환사 검색 및 랭크 정보 조회

## 데이터베이스 모델

### User (`src/db/models/user.js`)
```javascript
{
  puuid,              // Riot PUUID (PK)
  groupId,            // 그룹 ID (PK)
  win, lose,          // 승패 통계
  defaultRating,      // 기본 레이팅
  additionalRating,   // 추가 레이팅
  role                // 'member' | 'admin' | 'outsider'
}
```

### Summoner (`src/db/models/summoner.js`)
```javascript
{
  puuid,              // Riot PUUID (PK)
  name,               // 소환사명
  rankTier,           // 랭크 티어
  mainPosition        // 메인 포지션
}
```

### Match (`src/db/models/match.js`)
```javascript
{
  gameId,             // 게임 ID (PK)
  groupId,            // 그룹 ID
  team1, team2,       // 팀 구성 (JSON)
  winTeam             // 승리팀 (1|2|null)
}
```

### Group (`src/db/models/group.js`)
```javascript
{
  id,                 // 그룹 ID (PK)
  groupName,          // 그룹명
  discordGuildId      // Discord 서버 ID
}
```

## API 엔드포인트

```
GET  /api/summoners/name/:name     # 소환사 정보 조회
POST /api/group/register           # 그룹 생성
GET  /api/group/ranking            # 그룹 레이팅 순위
POST /api/group/retrieve-match     # 매치 데이터 갱신
POST /api/group/setUserRole        # 사용자 역할 설정
```

## 환경 변수

`.env_defaults` 파일 참조:

```bash
SERVICE_PORT=3000              # 서버 포트
RIOT_API_KEY=                  # Riot API 키 (필수)
DISCORD_BOT_TOKEN=             # Discord 봇 토큰 (필수)
DISCORD_APPLICATION_ID=        # Discord 앱 ID (필수)
DATABASE_HOST=localhost        # MySQL 호스트
DATABASE_NAME=mydb             # DB 이름
DATABASE_USER=root             # DB 유저
DATABASE_PASS=                 # DB 비밀번호
```

## 애플리케이션 초기화 흐름

```
app.js
  └→ loaders/index.js
       ├→ sequelize.js     # MySQL 연결
       ├→ express.js       # Express 설정
       ├→ discord.js       # Discord 봇 초기화
       └→ socket.io.js     # WebSocket 설정
```

## 개발 가이드라인

### 코드 스타일
- ESLint + Prettier 사용
- 비동기 함수는 async/await 패턴 사용

### 새 Discord 명령어 추가
1. `src/commands/` 디렉토리에 새 파일 생성
2. `data` (명령어 정의)와 `execute` (실행 함수) 내보내기
3. 봇 재시작 시 자동으로 명령어 등록됨

### 새 API 라우트 추가
1. `src/api/routes/`에 라우트 파일 생성
2. `src/api/index.js`에서 라우터 등록

## 주의사항

- PUUID 기반으로 사용자 식별 (riotId에서 마이그레이션 완료)
- 매칭 결과는 최대 3개까지 표시 (변수로 설정 가능)
- 여러 Discord 서버에서 독립적으로 운영 가능
