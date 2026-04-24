# 업적 대시보드 페이지 - 프론트엔드 구현 스펙

## 개요

그룹 전체 업적 현황을 한 화면에서 보고, 카테고리별 카드로 둘러보다가 특정 업적을 클릭해 랭킹까지 깊이 들어갈 수 있는 대시보드.

기존 개인 업적 페이지는 유지한 채, **그룹 단위 관점**의 새 페이지를 추가한다.

---

## 페이지 구성

### 1) 업적 대시보드 (`/achievement-dashboard/:groupId` 또는 그룹 전환 라우팅 기존 규칙 따라감)

화면 구조:

```
┌──────────────────────────────────────────────┐
│ [히어로 요약 영역]                               │
│  해금 X/Y (X.X%)    이번 주 신규 N개              │
│  총 해금 카운트 N회   미개척 N개                   │
│  최다 달성자 TOP 3: 🥇... 🥈... 🥉...             │
├──────────────────────────────────────────────┤
│ [카테고리 히트맵]                                 │
│  각 카테고리별 해금률 바차트 (정렬: 해금률 내림차순)  │
│  streak  ███████ 70%                         │
│  voice   █████ 50%                           │
│  honor   ██ 20%                              │
├──────────────────────────────────────────────┤
│ [카테고리 아코디언]                               │
│  ▼ streak (연승/연패) — 10/16 해금됨              │
│    ┌────┐ ┌────┐ ┌────┐ ┌────┐                 │
│    │ 🔥 │ │ 🔥 │ │ 💀 │ │ 💀 │ ... (카드 그리드)   │
│    └────┘ └────┘ └────┘ └────┘                 │
│  ▶ tier (티어 승급)                               │
│  ▶ voice (보이스 체류)                             │
│  ...                                              │
└──────────────────────────────────────────────┘
```

### 2) 업적 랭킹 상세 (`/achievement-dashboard/:groupId/ranking/:achievementId`)

화면 구조:

```
┌──────────────────────────────────────────────┐
│ 🔥 10연승          [EMERALD 티어 뱃지]            │
│ "10연승을 달성하세요"                              │
│ 달성: 8/125 (6.4%)                              │
│ 최초 🥇 홍길동 (2026-02-03)                       │
│ 최근 김철수 (2026-04-20)                          │
├──────────────────────────────────────────────┤
│ 🏆 달성자 랭킹 (빠른 순)                          │
│   1. 🥇 홍길동   2026-02-03                       │
│   2. 🥈 박영희   2026-02-15                       │
│   3. 🥉 김철수   2026-04-20                       │
│   4.    ...                                     │
├──────────────────────────────────────────────┤
│ 📈 미달성자 진행도 TOP 10 (hasProgress=true일 때) │
│   이순신: 9/10 (한 판 남음!)                      │
│   유관순: 7/10                                    │
│   ...                                             │
└──────────────────────────────────────────────┘
```

---

## API 명세

백엔드 base path: `/api/achievement`

### 1) 대시보드 요약

```
GET /api/achievement/:groupId/dashboard
```

**Response:**
```json
{
  "result": {
    "summary": {
      "totalAchievements": 205,
      "unlockedAchievements": 97,
      "unlockRate": 47.3,
      "totalUnlocks": 4097,
      "newUnlocksThisWeek": 2422,
      "totalActiveUsers": 125
    },
    "topUsers": [
      { "puuid": "abc...", "name": "쥬티키스#kr2", "unlockCount": 81 }
    ],
    "categoryStats": [
      {
        "category": "win_streak",
        "totalAchievements": 8,
        "unlockedAchievements": 6,
        "unlockRate": 62.5,
        "totalUnlocks": 405,
        "avgUnlockRate": 20.3
      }
    ]
  }
}
```

필드 설명:
- `summary.totalUnlocks`: 전체 유저 × 업적의 총 해금 합계
- `summary.newUnlocksThisWeek`: 최근 7일 이내 해금된 건수
- `summary.totalActiveUsers`: 블랙리스트/부캐 제외한 본캐 멤버 수
- `categoryStats[].unlockRate`: 해당 카테고리 업적 중 1명 이상이 해금한 비율
- `categoryStats[].avgUnlockRate`: 해당 카테고리에서 한 유저가 평균적으로 몇 %를 땄는지 (인당 획득률)

### 2) 카테고리별 카드

```
GET /api/achievement/:groupId/category/:category
```

`:category`는 다음 값 중 하나:
`match`, `games`, `win_streak`, `lose_streak`, `tier`, `voice`, `challenge`, `underdog`, `late_night`, `weekend_games`, `weekday_games`, `games_per_day`, `welcomer`, `anniversary`, `consecutive_days`, `honor_received`, `honor_voted_count`, `match_mvp`, `match_mvp_streak`, `reverse_win`, `reverse_lose`, `sweep_win`, `sweep_lose`, `night_owl`, `channel_creator`

**Response:**
```json
{
  "result": {
    "category": "win_streak",
    "totalActiveUsers": 125,
    "achievements": [
      {
        "id": "WIN_STREAK_BRONZE",
        "name": "2연승",
        "description": "2연승을 달성하세요",
        "emoji": "🔥",
        "tier": "BRONZE",
        "category": "win_streak",
        "goal": 2,
        "unlockedCount": 100,
        "unlockRate": 80,
        "recentUnlockers": [
          { "puuid": "...", "name": "쌈돼지덮밥#KR1", "unlockedAt": "2026-04-22T11:05:13Z" }
        ],
        "firstUnlocker": { "puuid": "...", "name": "쥬티키스#kr2", "unlockedAt": "..." },
        "latestUnlocker": { "puuid": "...", "name": "쌈돼지덮밥#KR1", "unlockedAt": "..." }
      }
    ]
  }
}
```

### 3) 업적 랭킹 상세

```
GET /api/achievement/:groupId/ranking/:achievementId
```

**Response:**
```json
{
  "result": {
    "achievement": {
      "id": "WIN_STREAK_EMERALD",
      "name": "10연승",
      "description": "10연승을 달성하세요",
      "emoji": "🔥",
      "tier": "EMERALD",
      "category": "win_streak",
      "goal": 10,
      "unlockedCount": 8,
      "unlockRate": 6.4,
      "firstUnlocker": { "puuid": "...", "name": "홍길동", "unlockedAt": "..." },
      "latestUnlocker": { "puuid": "...", "name": "김철수", "unlockedAt": "..." }
    },
    "unlockers": [
      { "rank": 1, "puuid": "...", "name": "홍길동", "unlockedAt": "2026-02-03T..." }
    ],
    "topProgress": [
      { "puuid": "...", "name": "이순신", "currentValue": 9, "goal": 10, "progressRate": 90 }
    ],
    "hasProgress": true
  }
}
```

- `hasProgress: false`면 `topProgress`는 빈 배열이며 UI에 "진행도 추적 미지원" 처리
- `unlockers`는 **달성 시간 오름차순** (먼저 딴 사람이 1등)
- `topProgress`는 **진행도 내림차순 TOP 10**, 값이 0인 유저는 제외됨

---

## UI/UX 디자인 지침

### 카드 시각화
- **티어 뱃지 색상**: 기존 랭킹/프로필에서 쓰는 티어 색상 팔레트 재사용 (IRON 회색 → CHALLENGER 주황/프리미엄색)
- **해금 상태 3가지**:
  1. 내가 해금 O → 컬러풀 하이라이트 + emoji
  2. 내가 해금 X, 그룹 내 누군가 해금 O → 보통 밝기 + "N명 달성" 표시
  3. 완전 미개척 (그룹 전체 0명) → grayscale + 🔒 "아직 아무도" 배지
- **프로그레스 바**: 보유율 0~100% 시각화. 100%는 특별 색상(금빛) 처리해도 좋음
- **최근 달성자 아바타**: 카드 하단 오른쪽에 최대 3명 겹쳐서 (Discord 스타일). hover 시 이름 툴팁
- **카드 클릭**: 랭킹 상세 페이지로 이동

### 히어로 영역
- 큰 숫자로 강조: "147/205 해금" 같은 진행감
- `newUnlocksThisWeek`은 초록색 + 증가 아이콘으로 "활발함" 시그널
- `미개척 N개`는 주황색 + 🔒 아이콘으로 "도전 남음" 시그널
- TOP 3는 프로필 아바타 + 이름 + 해금 수를 세트로. 클릭 시 해당 유저 프로필(`/myinfo/:puuid` 또는 기존 프로필 URL 규칙)로

### 카테고리 히트맵
- 수평 바 차트 (chart.js 또는 단순 CSS 바). x축은 0~100%
- 카테고리명은 한글 라벨 매핑 필요:
  - `streak` → 연승/연패
  - `tier` → 티어 승급
  - `voice` → 보이스 체류
  - `honor_received` → 명예 받음
  - `honor_voted_count` → 명예 투표
  - `match_mvp` → 매치 MVP
  - `late_night` → 심야 플레이
  - `sweep_win` → 세트 스윕 승
  - `sweep_lose` → 세트 스윕 패
  - `reverse_win` → 역전승
  - `reverse_lose` → 역전패
  - `underdog` → 언더독 승
  - `welcomer` → 환영 캐리
  - `consecutive_days` → 연속 출석
  - `weekend_games` → 주말 플레이
  - `weekday_games` → 평일 플레이
  - `games_per_day` → 하루 최다
  - `night_owl` → 야행성
  - `channel_creator` → 채널 생성
  - `match_mvp_streak` → MVP 연속
  - `anniversary` → 기념일
  - `games` → 판수
  - `challenge` → 챌린지 메달
  - `match` → 첫 승리
- 바 클릭 시 해당 카테고리 아코디언 자동 펼침 + 스크롤

### 카테고리 아코디언
- 초기 상태: 모두 접힘 (초기 대시보드 로딩은 `/dashboard` 하나만)
- 펼칠 때 `/category/:category` lazy 로딩. 로딩 스피너 표시
- 카드 그리드: 반응형 (데스크탑 4열 / 태블릿 3열 / 모바일 2열)
- 해금률 내림차순 정렬 기본 (쉬운 업적이 앞, 어려운/미개척이 뒤에)
- 카테고리 내 정렬 토글: "해금률↓ / 티어순 / 최근 달성순"

### 랭킹 상세 페이지
- 상단에 큰 업적 뱃지 + 설명 + 집계
- 달성자 리스트: 1등에게 🥇, 2등 🥈, 3등 🥉. 4등부터는 숫자만
- 달성 시간: 상대 시간("3일 전") + hover 시 절대 시간
- 진행도 섹션(`hasProgress: true`일 때만):
  - "한 판 남았어요!" 같은 친근한 카피 (`goal - currentValue === 1`일 때)
  - 프로그레스 바 시각화
- 자기 자신 하이라이트: `unlockers`나 `topProgress`에 내가 있으면 강조 색상

---

## 데이터 로딩 전략

1. **페이지 진입**: `GET /dashboard` 1회 → 히어로/히트맵/카테고리 헤더 렌더 (4.5KB)
2. **카테고리 펼침**: 해당 `GET /category/:category` 호출 (카테고리당 8~10KB). 이미 로드한 카테고리는 캐시
3. **카드 클릭**: 랭킹 페이지로 라우팅 → `GET /ranking/:achievementId` 1회 (17KB)

**캐시 정책 제안**:
- Redux 또는 react-query 사용 시 동일 그룹 내에서는 페이지 이동해도 유지
- TTL 없이 두고 "새로고침" 버튼으로 명시적 invalidate가 깔끔 (업적은 매치 종료 때만 변함)
- 매치 종료 관련 이벤트(예: 랭킹 페이지 업데이트)를 감지할 수 있다면 자동 invalidate

---

## 추가 고려 사항

### 접근 권한
- 기존 개인 업적 API와 동일하게 **인증 불필요**. 그룹원이 아니어도 볼 수 있음
- 자기 강조 표시는 로그인한 puuid가 있을 때만

### 빈 상태
- 활성 유저 0명: "아직 매치가 없어요" 안내
- 해금 0개인 카테고리: "아직 이 카테고리의 업적을 딴 사람이 없어요" + 도전 유도
- `hasProgress: false` & 미달성: "진행도 추적 미지원" 작게 회색으로

### 성능/UX
- 카테고리 아코디언 펼침 시 skeleton loader
- 전체 펼치기 버튼이 있으면 24개 병렬 호출 (서버에서 ~330ms 예상)

### 국제화
- 현재 백엔드 이름/설명은 한글. 다국어 지원 생기면 `lang` 쿼리 파라미터 추가 여지 열어둠

---

## 참고

- 백엔드 구현: `src/controller/achievement.js`, `src/api/routes/achievement.js`
- 업적 정의 원본: `src/services/achievement/definitions.js` (총 205개, 24 카테고리)
- 기존 개인 업적 API 유지됨: `GET /api/achievement/:groupId/:puuid`
- 기존 프로필/프로필 URL 규칙은 graves 프로젝트 기존 관례 따를 것
