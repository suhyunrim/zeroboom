/**
 * 온보딩 각 화면의 description 아래에 덧붙일 그룹별 커스텀 문구.
 *
 * group.settings.onboardingMessages[key]: string (없거나 빈 값이면 아무것도 추가하지 않음)
 *
 * key 목록:
 *   welcome      - 첫 진입 (포지션 선택)
 *   tierCategory - 티어 카테고리 선택
 *   tierStep     - 티어 단계 선택
 *   nameInput    - 닉네임 입력 직전
 *   complete     - 등록 완료
 */

function getCustomExtra(group, key) {
  const messages = group && group.settings && group.settings.onboardingMessages;
  const extra = messages && messages[key];
  if (typeof extra !== 'string') return '';
  const trimmed = extra.trim();
  return trimmed ? `\n\n${trimmed}` : '';
}

module.exports = { getCustomExtra };
