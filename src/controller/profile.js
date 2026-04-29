/**
 * 프로필 방명록/방문자 관련 순수 로직.
 * DB 핸들링은 라우트에서 직접 하고, 여기서는 가시성 판단·날짜 포맷팅만 담당.
 */

/**
 * 비밀글이 뷰어에게 보여야 하는지 판단.
 * 공개글은 모두에게 보임. 비밀글은 작성자/프로필주인/그룹어드민,
 * 그리고 답글이라면 부모 댓글 작성자에게도 보임 (스레드 대화 참여자).
 */
const canViewComment = ({ comment, viewerDiscordId, ownerDiscordId, isAdmin, parentAuthorDiscordId }) => {
  if (!comment.isSecret) return true;
  if (!viewerDiscordId) return false;
  if (comment.authorDiscordId === viewerDiscordId) return true;
  if (ownerDiscordId && ownerDiscordId === viewerDiscordId) return true;
  if (parentAuthorDiscordId && parentAuthorDiscordId === viewerDiscordId) return true;
  if (isAdmin) return true;
  return false;
};

/**
 * 댓글을 삭제할 수 있는지 판단. 작성자 본인 또는 그룹 어드민만 가능.
 */
const canDeleteComment = ({ comment, viewerDiscordId, isAdmin }) => {
  if (!viewerDiscordId) return false;
  if (comment.authorDiscordId === viewerDiscordId) return true;
  return !!isAdmin;
};

/**
 * 로컬 시간 기준 YYYY-MM-DD 문자열로 변환 (싸이월드 투데이 카운트용).
 */
const formatVisitDate = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * 댓글 content에서 <@puuid> 멘션 토큰을 추출 (중복 제거 + 상한 적용).
 * 같은 그룹 본캐인지 검증은 호출자 책임.
 * 댓글당 최대 MENTION_LIMIT명까지만 — 그 이상은 알림 폭격 방지로 무시.
 */
const MENTION_REGEX = /<@([\w-]+)>/g;
const MENTION_LIMIT = 5;
const extractMentionPuuids = (content) => {
  if (!content) return [];
  const set = new Set();
  Array.from(String(content).matchAll(MENTION_REGEX)).forEach((m) => {
    if (m[1] && set.size < MENTION_LIMIT) set.add(m[1]);
  });
  return [...set];
};

module.exports = {
  canViewComment,
  canDeleteComment,
  formatVisitDate,
  extractMentionPuuids,
  MENTION_LIMIT,
};
