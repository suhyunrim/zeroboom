const jwt = require('jsonwebtoken');
const config = require('../../config');
const models = require('../../db/models');

// JWT 슬라이딩 만료 설정
const TOKEN_TTL = '7d';
// 만료까지 남은 시간이 이 값(3.5일) 미만이면 토큰을 재발급한다.
// 정상적으로 활동하는 동안에는 만료 전 갱신이 반복되어 사실상 만료되지 않는다.
const RENEW_THRESHOLD_SEC = 3.5 * 24 * 60 * 60;
const RENEWED_TOKEN_HEADER = 'X-Renewed-Token';

// 세션 쿠키 설정
// localStorage(헤더 토큰)는 모바일 Safari ITP가 비우는 경우가 있어 새로고침 시 로그인이 풀린다.
// 서버가 Set-Cookie로 심는 httpOnly 쿠키는 script-writable 저장소가 아니라 ITP 휘발 대상이 아니므로,
// 헤더 토큰이 사라져도 쿠키로 세션을 유지한다. 동일 오리진이라 /api 요청에 자동 탑재된다.
const SESSION_COOKIE = 'zb_session';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

const signSessionToken = (payload) => jwt.sign(payload, config.jwtSecret, { expiresIn: TOKEN_TTL });

const setSessionCookie = (res, token) => {
  res.cookie(SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTIONS, maxAge: COOKIE_MAX_AGE_MS });
};

const clearSessionCookie = (res) => {
  res.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
};

// Authorization 헤더(Bearer)를 우선 사용하고, 없으면 세션 쿠키로 폴백한다.
const getTokenFromReq = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.split(' ')[1];
  return (req.cookies && req.cookies[SESSION_COOKIE]) || null;
};

/**
 * 디코딩된 payload로 토큰을 재발급해 응답 헤더 + 세션 쿠키에 실어준다.
 * 만료가 임박(RENEW_THRESHOLD_SEC 미만)했을 때만 갱신해 불필요한 재발급을 막는다.
 * 프론트는 응답에 이 헤더가 있으면 저장된 토큰을 교체한다.
 */
const renewTokenIfNeeded = (res, decoded) => {
  const now = Math.floor(Date.now() / 1000);
  if (!decoded || !decoded.exp || decoded.exp - now > RENEW_THRESHOLD_SEC) return;
  // iat/exp는 sign 옵션과 충돌하므로 제거 후 재발급
  const { iat, exp, ...payload } = decoded;
  const token = signSessionToken(payload);
  res.setHeader(RENEWED_TOKEN_HEADER, token);
  setSessionCookie(res, token);
};

/**
 * JWT 토큰 검증 미들웨어
 * req.user에 디코딩된 유저 정보를 설정
 */
const verifyToken = (req, res, next) => {
  const token = getTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ result: '인증이 필요합니다.' });
  }

  try {
    req.user = jwt.verify(token, config.jwtSecret);
    renewTokenIfNeeded(res, req.user);
    return next();
  } catch (e) {
    return res.status(401).json({ result: '유효하지 않은 토큰입니다.' });
  }
};

/**
 * Authorization 헤더 또는 세션 쿠키가 있으면 디코딩해서 req.user 세팅, 없거나 invalid면 그냥 통과.
 * 비로그인도 허용해야 하는 엔드포인트용 (예: 방명록 댓글 목록).
 */
const optionalAuth = (req, res, next) => {
  const token = getTokenFromReq(req);
  if (!token) return next();
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    renewTokenIfNeeded(res, req.user);
  } catch (e) {
    // 무효 토큰은 그냥 비로그인 취급
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
  renewTokenIfNeeded,
  RENEWED_TOKEN_HEADER,
  TOKEN_TTL,
  SESSION_COOKIE,
  signSessionToken,
  setSessionCookie,
  clearSessionCookie,
};
