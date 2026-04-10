# 온보딩 설정 프론트엔드 구현 프롬프트

## 개요

방 설정 페이지에 "온보딩 DM 설정" 섹션을 추가한다. 신규 유저가 Discord 서버에 입장할 때 봇이 자동으로 DM을 보내 등록을 진행하는 기능의 설정 UI이다.

---

## API 스펙

### 1. 설정 조회/저장 (기존 API 활용)

**GET** `/api/group/:groupId/settings`
- 인증: Bearer JWT 필수
- 응답: 현재 settings JSON 객체

**PATCH** `/api/group/:groupId/settings`
- 인증: Bearer JWT 필수
- Body: 업데이트할 키-값 (기존 설정과 merge됨)
- 응답: 업데이트된 전체 settings 객체

### 2. Discord 서버 역할 목록 조회 (신규 API)

**GET** `/api/group/:groupId/discord-roles`
- 인증: Bearer JWT 필수
- 응답: Discord 역할 배열 (봇 관리 역할, @everyone 제외)

```json
[
  { "id": "123456789", "name": "인증됨", "color": "#00ff00", "position": 10 },
  { "id": "234567890", "name": "탑 라이너", "color": "#ff0000", "position": 9 },
  ...
]
```
- position 내림차순 정렬 (상위 역할이 먼저)

---

## Settings 데이터 구조

```json
{
  "onboardingEnabled": false,
  "onboardingRoleId": "123456789",
  "onboardingPositionRoles": {
    "TOP": "roleId_or_null",
    "JUNGLE": "roleId_or_null",
    "MIDDLE": "roleId_or_null",
    "BOTTOM": "roleId_or_null",
    "UTILITY": "roleId_or_null"
  },
  "onboardingTierRoles": {
    "IRON": "roleId_or_null",
    "BRONZE": "roleId_or_null",
    "SILVER": "roleId_or_null",
    "GOLD": "roleId_or_null",
    "PLATINUM": "roleId_or_null",
    "EMERALD": "roleId_or_null",
    "DIAMOND": "roleId_or_null",
    "MASTER": "roleId_or_null",
    "GRANDMASTER": "roleId_or_null",
    "CHALLENGER": "roleId_or_null"
  }
}
```

---

## UI 구성

### 섹션: 온보딩 DM 설정

방 설정 페이지 내에 아래 항목들을 배치한다.

#### 1. 온보딩 활성화 토글

- **토글 스위치**: `onboardingEnabled` (기본값: false)
- 레이블: "신규 입장 시 DM 온보딩"
- 설명 텍스트: "활성화하면 서버에 새로 입장한 유저에게 자동으로 등록 DM을 보냅니다"
- 토글 off 시 아래 역할 설정 영역은 비활성화(dimmed) 처리

#### 2. 기본 인증 역할

- **드랍다운 (Select)**: Discord 역할 목록에서 선택
- 레이블: "인증 완료 역할"
- 설명: "온보딩 완료 시 부여할 기본 역할"
- 저장 키: `onboardingRoleId`
- 선택 안 함 옵션 포함 (null)

#### 3. 포지션별 역할 매핑

5개 포지션 각각에 대해 Discord 역할을 매핑하는 드랍다운:

| 포지션 | 이모지 | 저장 키 |
|--------|--------|---------|
| TOP | ⚔️ | `onboardingPositionRoles.TOP` |
| JUNGLE | 🐺 | `onboardingPositionRoles.JUNGLE` |
| MIDDLE | ✨ | `onboardingPositionRoles.MIDDLE` |
| BOTTOM | 🏹 | `onboardingPositionRoles.BOTTOM` |
| UTILITY | 💖 | `onboardingPositionRoles.UTILITY` |

- 각 드랍다운: Discord 역할 목록에서 선택 (선택 안 함 가능)
- 역할 이름 옆에 색상 표시 (role.color)

#### 4. 티어별 역할 매핑

10개 티어 각각에 대해 Discord 역할을 매핑하는 드랍다운:

| 티어 | 이모지 | 저장 키 |
|------|--------|---------|
| IRON | 🪨 | `onboardingTierRoles.IRON` |
| BRONZE | 🥉 | `onboardingTierRoles.BRONZE` |
| SILVER | 🥈 | `onboardingTierRoles.SILVER` |
| GOLD | 🥇 | `onboardingTierRoles.GOLD` |
| PLATINUM | 💎 | `onboardingTierRoles.PLATINUM` |
| EMERALD | 💚 | `onboardingTierRoles.EMERALD` |
| DIAMOND | ♦️ | `onboardingTierRoles.DIAMOND` |
| MASTER | 🏅 | `onboardingTierRoles.MASTER` |
| GRANDMASTER | 🔥 | `onboardingTierRoles.GRANDMASTER` |
| CHALLENGER | 👑 | `onboardingTierRoles.CHALLENGER` |

---

## 동작 흐름

1. 페이지 로드 시 `GET /settings`와 `GET /discord-roles`를 **병렬** 호출
2. settings 값으로 각 필드 초기화 (없는 키는 기본값 사용)
3. 사용자가 설정 변경 시 `PATCH /settings`로 변경된 값만 전송
4. 저장 성공 시 토스트 알림, 실패 시 에러 메시지 표시

### 저장 방식

- **개별 저장**: 각 드랍다운/토글 변경 시 즉시 PATCH (debounce 적용 권장)
- 또는 **일괄 저장**: 하단 저장 버튼으로 모아서 한 번에 PATCH
- 프로젝트 기존 패턴에 맞춰 선택

### PATCH 요청 예시

토글만 변경:
```json
{ "onboardingEnabled": true }
```

포지션 역할 전체 변경:
```json
{
  "onboardingPositionRoles": {
    "TOP": "123456789",
    "JUNGLE": "234567890",
    "MIDDLE": null,
    "BOTTOM": null,
    "UTILITY": "345678901"
  }
}
```

---

## 참고

- Discord 역할 드랍다운에서 역할 이름 앞에 색상 dot(●)을 표시하면 구분이 쉬움
- 포지션/티어 역할은 모두 optional (설정 안 하면 해당 역할 부여 안 함)
- `onboardingEnabled`가 false이면 역할 매핑을 설정해도 동작하지 않음 (UI에서 dimmed 처리로 안내)
