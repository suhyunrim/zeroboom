const jwt = require('jsonwebtoken');
const config = require('../../config');
const models = require('../../db/models');
const { logger } = require('../../loaders/logger');

const TOKEN_TTL = '7d';
// express.js의 CORS exposedHeaders가 참조 (현재 X-Renewed-Token 자체는 사용 안 함)
const RENEWED_TOKEN_HEADER = 'X-Renewed-Token';

// 세션 쿠키 설정
// 모바일 Safari는 zeroboom.lol 도메인 패밀리(서브도메인 graves.zeroboom.lol 포함)의
// localStorage에 추적방지 만료 캡을 걸어 새로고침 시 토큰이 사라진다. 서버가 Set-Cookie로
// 심는 httpOnly 쿠키는 script-writable 저장소가 아니라 이 캡 대상이 아니므로 세션이 유지된다.
//
// ★ SameSite: 프론트(graves.zeroboom.lol)와 API(zeroboom.lol)는 cross-origin이다.
//   SameSite=Lax는 same-site 판정이어도 모바일 브라우저에서 cross-origin XHR(특히 POST)에
//   쿠키를 안 싣는 경우가 있어, 인증 POST(/visit, 댓글, 한마디 등)가 401 → 프론트 강제 로그아웃이
//   발생했다. cross-origin 자격증명 요청에 쿠키를 확실히 싣기 위해 SameSite=None; Secure를 쓴다.
//   ★ HTTPS 판정은 req.secure로 한다(라이브 NODE_ENV는 unset이라 신뢰 불가). nginx가
//   X-Forwarded-Proto=$scheme를 넘기고 app은 trust proxy라 HTTPS 요청에서 req.secure=true가 된다.
//   None은 Secure(HTTPS) 필수 → HTTPS면 None+Secure, HTTP(로컬)면 Lax 폴백.
//
// ★ 헤더 크기 주의: nginx proxy_buffer_size(기본 ~4k)를 넘기면 502가 난다. JWT(~1.5KB)를
//   응답 헤더에 2개 실으면 초과하므로, 한 응답에 큰 JWT 헤더는 최대 1개만 둔다.
//   - 콜백: Location의 ?token= 만 (쿠키 안 심음)
//   - /me: Set-Cookie 만 (프론트 재시드 토큰은 응답 body로 전달)
const SESSION_COOKIE = 'zb_session';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// 요청 프로토콜(req.secure)로 쿠키 보안 속성 결정. HTTPS면 SameSite=None; Secure(cross-origin
// XHR에 쿠키 전송), HTTP(로컬)면 Lax. set/clear가 같은 속성이어야 쿠키가 정상 제거된다.
const sessionCookieOptions = (req) => {
  const isHttps = !!(req && req.secure);
  return {
    httpOnly: true,
    path: '/',
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
  };
};

const signSessionToken = (payload) => jwt.sign(payload, config.jwtSecret, { expiresIn: TOKEN_TTL });

const setSessionCookie = (res, token) => {
  res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions(res.req), maxAge: COOKIE_MAX_AGE_MS });
};

const clearSessionCookie = (res) => {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(res.req));
};

// 인증 토큰 후보들을 우선순위대로 모은다: Authorization(Bearer) 먼저, 그다음 세션 쿠키.
// ★ 둘 다 후보로 반환해, 하나(예: 모바일 localStorage에 남은 낡은 Bearer)가 무효여도
//   다른 하나(유효한 세션 쿠키)로 통과시킨다. 이전엔 Bearer가 있으면 그것만 검증해서,
//   무효 Bearer가 유효 쿠키를 가려 401이 났다(모바일 AI 채팅 등에서 발생).
const getCandidateTokens = (req) => {
  const tokens = [];
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) tokens.push(authHeader.split(' ')[1]);
  const cookieToken = req.cookies && req.cookies[SESSION_COOKIE];
  if (cookieToken) tokens.push(cookieToken);
  return tokens;
};

/**
 * JWT 토큰 검증 미들웨어
 * Bearer/쿠키 후보를 순서대로 검증해 하나라도 유효하면 통과(req.user 설정).
 */
const verifyToken = (req, res, next) => {
  const tokens = getCandidateTokens(req);
  let lastError = null;
  for (const token of tokens) {
    try {
      req.user = jwt.verify(token, config.jwtSecret);
      return next();
    } catch (e) {
      lastError = e; // 다음 후보 시도
    }
  }
  // ★ 임시 진단(AI 경로만): 어떤 자격증명이 실렸는지/검증 결과를 값 노출 없이 기록.
  if (req.originalUrl && req.originalUrl.includes('/api/ai')) {
    const hasBearer = !!(req.headers.authorization && req.headers.authorization.startsWith('Bearer '));
    const hasCookie = !!(req.cookies && req.cookies[SESSION_COOKIE]);
    logger.warn(`[auth.diag] ${req.method} ${req.originalUrl} 401 hasBearer=${hasBearer} hasCookie=${hasCookie} err=${lastError ? lastError.name : 'none'}`);
  }
  return res.status(401).json({ result: tokens.length ? '유효하지 않은 토큰입니다.' : '인증이 필요합니다.' });
};

/**
 * Authorization 헤더 또는 세션 쿠키가 있으면 디코딩해서 req.user 세팅, 없거나 invalid면 그냥 통과.
 * 비로그인도 허용해야 하는 엔드포인트용 (예: 방명록 댓글 목록).
 */
const optionalAuth = (req, res, next) => {
  const tokens = getCandidateTokens(req);
  for (const token of tokens) {
    try {
      req.user = jwt.verify(token, config.jwtSecret);
      break; // 유효 토큰 찾으면 중단
    } catch (e) {
      // 다음 후보 시도
    }
  }
  return next();
};

/**
 * 그룹 어드민 여부를 boolean으로 반환. 슈퍼 어드민이면 모든 그룹 통과.
 * 같은 discordId로 본캐+부캐가 등록된 경우 admin 행이 LIMIT 1에서 누락될 수 있어
 * role='admin'인 행이 하나라도 있는지로 판정한다.
 */
const isGroupAdmin = async (groupId, discordId) => {
  if (!groupId || !discordId) return false;
  const superAdmin = await models.super_admin.findByPk(discordId);
  if (superAdmin) return true;
  const adminRow = await models.user.findOne({
    where: { groupId, discordId, role: 'admin' },
    attributes: ['role'],
  });
  return !!adminRow;
};

const requireGroupAdmin = async (req, res, next) => {
  const groupId = Number(req.params.groupId || req.body.groupId);
  const { discordId } = req.user;

  try {
    if (await isGroupAdmin(groupId, discordId)) return next();
    return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
  } catch (e) {
    return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
  }
};

module.exports = {
  verifyToken,
  optionalAuth,
  requireGroupAdmin,
  isGroupAdmin,
  RENEWED_TOKEN_HEADER,
  TOKEN_TTL,
  SESSION_COOKIE,
  signSessionToken,
  setSessionCookie,
  clearSessionCookie,
};
